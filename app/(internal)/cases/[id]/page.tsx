import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireStaff, viewerTz } from "@/lib/session";
import { now, simToday } from "@/lib/clock";
import { can } from "@/lib/auth/rbac";
import { metricSeries, chartMarkers } from "@/lib/queries/merchant";
import { BandPill, MerchantStatusPill, SeverityPill, SlaText, Avatar } from "@/components/ui/badges";
import { CASE_STATUS_LABEL } from "@/lib/domain/caseStateMachine";
import { fmtDate, fmtTime, humanize } from "@/lib/format";
import { METRICS, type MetricKey, type TraceNode, describeCondition, collectMetrics, RuleDefinitionSchema } from "@/lib/domain/rules/dsl";
import { valueLabel } from "@/components/charts/scale";
import { MetricsChart } from "@/components/merchant/MetricsChart";
import { CaseActions } from "@/components/cases/CaseActions";
import { NoteBox } from "@/components/cases/NoteBox";
import { DismissInline } from "@/components/cases/DismissInline";
import { isoDay } from "@/lib/domain/reserves/calc";
import { getActivePolicy } from "@/lib/domain/policy";
import { CONTROL_LABEL, controlSummary } from "@/lib/domain/controls/text";
import { StoryBriefing, storyKeyFor } from "@/components/demo/StoryBriefing";
import { CaseExplainer } from "@/components/demo/CaseExplainer";
import { isMockMode } from "@/lib/mode";

export const metadata = { title: "Case" };

const fmtFor = (k: string) => {
  const u = METRICS[k as MetricKey]?.unit;
  return u === "money" ? "money" : u === "ratio" ? "ratio" : "count";
};

/** "What happened, and what should we do?" (DESIGN.md §3): evidence, chronology, actions. */
export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireStaff();
  const c = await db.case.findUnique({
    where: { id },
    include: { merchant: true, alerts: { orderBy: { metricDate: "asc" } }, events: { orderBy: { createdAt: "asc" } } },
  });
  if (!c) notFound();
  const [tz, at, today, users, rfis, approvals, series, markers, reasons, policy, controls, app] = await Promise.all([
    viewerTz(),
    now(),
    simToday(),
    db.user.findMany({ select: { id: true, name: true, role: true } }),
    db.rfi.findMany({ where: { caseId: id }, orderBy: { createdAt: "desc" } }),
    db.approvalRequest.findMany({ where: { caseId: id }, orderBy: { createdAt: "desc" } }),
    metricSeries(c.merchantId, 90),
    chartMarkers(c.merchantId, 90),
    db.reasonCode.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    getActivePolicy(),
    db.control.findMany({ where: { merchantId: c.merchantId, status: { in: ["ACTIVE", "PENDING_APPROVAL"] } } }),
    db.application.findFirst({ where: { merchantId: c.merchantId }, orderBy: { submittedAt: "desc" } }),
  ]);
  const versions = await db.ruleVersion.findMany({ where: { id: { in: c.alerts.map((a) => a.ruleVersionId) } }, include: { rule: true } });
  const vBy = new Map(versions.map((v) => [v.id, v]));
  const name = new Map(users.map((u) => [u.id, u.name]));
  const m = c.merchant;
  const canWork = can(user.role, "case.work");
  const pendingApproval = approvals.find((a) => a.status === "PENDING");
  const openRfi = rfis.find((r) => r.status === "SENT" || r.status === "PARTIALLY_ANSWERED");

  return (
    <>
      <div className="crumbs">
        <Link href="/queues/my-work">Cases</Link>
        <span aria-hidden>/</span>
        <Link href={`/merchants/${m.id}`}>{m.dbaName ?? m.legalName}</Link>
      </div>
      <div className="title-row" style={{ alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div className="row-gap">
            <h1>{c.title ?? humanize(c.type)}</h1>
            <SeverityPill severity={c.priority} />
          </div>
          <div className="sub row-gap" style={{ gap: 6 }}>
            <Link className="link" href={`/merchants/${m.id}`}>{m.dbaName ?? m.legalName}</Link>
            <MerchantStatusPill status={m.status} />
            <BandPill band={m.currentBand} score={m.currentScore} />
            <span>· {humanize(c.type)} case opened {fmtDate(c.createdAt, tz)}</span>
          </div>
        </div>
        <div style={{ textAlign: "right", flex: "none" }}>
          <div className="meta">SLA</div>
          <div style={{ fontSize: 16 }} data-testid="case-sla"><SlaText due={c.slaDueAt} now={at} resolved={c.status === "RESOLVED"} /></div>
          <div className="meta">due {fmtDate(c.slaDueAt, tz)} {fmtTime(c.slaDueAt, tz)}</div>
        </div>
      </div>

      <StoryBriefing registrationNo={m.registrationNo} viewerRole={user.role} />
      <CaseExplainer
        caseType={c.type}
        ruleKeys={c.alerts.map((a) => a.ruleKey)}
        ruleNames={Object.fromEntries(versions.map((v) => [v.rule.key, v.rule.name]))}
        open={isMockMode() && !storyKeyFor(m.registrationNo)}
      />
      <div className="kpis" style={{ marginBottom: 16 }}>
        <div className="kpi">
          <div className="kpi-label">Status</div>
          <div className="kpi-value" style={{ fontSize: 18 }} data-testid="case-status">{CASE_STATUS_LABEL[c.status]}</div>
          <div className="kpi-sub">{c.resolutionCode ? <span className="id">{c.resolutionCode}</span> : pendingApproval ? "Waiting on a second approver" : openRfi ? `Documents due ${fmtDate(openRfi.dueAt, tz)}` : " "}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Owner</div>
          <div className="kpi-value row-gap" style={{ fontSize: 18 }}>
            {c.assigneeId ? <><Avatar name={name.get(c.assigneeId) ?? "?"} />{name.get(c.assigneeId)}</> : <span className="muted">Unassigned</span>}
          </div>
          <div className="kpi-sub">&nbsp;</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Alerts linked</div>
          <div className="kpi-value num" style={{ fontSize: 18 }}>{c.alerts.length}</div>
          <div className="kpi-sub">{c.alerts.length ? `${[...new Set(c.alerts.map((a) => a.ruleKey))].length} rules` : "Opened by a person or a job"}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Controls in force</div>
          <div className="kpi-value num" style={{ fontSize: 18 }}>{controls.filter((x) => x.status === "ACTIVE").length}</div>
          <div className="kpi-sub truncate">{controls.map((x) => CONTROL_LABEL[x.type]).join(", ") || "None"}</div>
        </div>
      </div>

      <div className="case-grid">
        <div className="case-main">
          <section className="panel" aria-labelledby="ev-h">
            <header>
              <div>
                <h2 id="ev-h">Evidence</h2>
                <div className="meta">What each rule saw on the day it fired</div>
              </div>
            </header>
            {c.alerts.length ? (
              <div className="list-rows">
                {c.alerts.map((a) => {
                  const ev = a.evidence as { metrics?: Record<string, number | null>; trace?: TraceNode; date?: string; ruleVersion?: number };
                  const v = vBy.get(a.ruleVersionId);
                  const def = v ? RuleDefinitionSchema.safeParse(v.definition) : null;
                  return (
                    <article key={a.id} style={{ padding: "12px 0" }} data-testid={`alert-${a.ruleKey}`}>
                      <div className="row-gap" style={{ justifyContent: "space-between" }}>
                        <div className="row-gap">
                          <SeverityPill severity={a.severity} />
                          <strong style={{ fontWeight: 500 }}>{v?.rule.name ?? a.ruleKey}</strong>
                        </div>
                        <span className="meta num">{isoDay(a.metricDate)}</span>
                      </div>
                      <div className="meta" style={{ marginTop: 2 }}>
                        <span className="id">{a.ruleKey}</span> v{v?.version ?? ev.ruleVersion}
                        {def?.success ? ` · fires when ${describeCondition(def.data.when)}` : ""}
                      </div>
                      {ev.metrics ? (
                        <dl className="kv" style={{ marginTop: 6, fontSize: 13 }}>
                          {orderedEvidence(ev.metrics, def?.success ? [...collectMetrics(def.data.when), ...def.data.evidenceMetrics] : []).map(([k, val]) => (
                            <div key={k} style={{ display: "contents" }}>
                              <dt>{METRICS[k as MetricKey]?.label ?? k}</dt>
                              <dd className={fmtFor(k) === "money" ? "money" : "num"}>{valueLabel(val, fmtFor(k))}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : (
                        <pre className="meta" style={{ whiteSpace: "pre-wrap", margin: "6px 0 0" }}>{JSON.stringify(a.evidence, null, 1)}</pre>
                      )}
                      <div className="row-gap" style={{ marginTop: 6 }}>
                        {a.status === "DISMISSED" ? (
                          <span className="meta">Dismissed · {a.dismissReasonCode}{a.dismissNote ? ` · ${a.dismissNote}` : ""}</span>
                        ) : canWork && c.status !== "RESOLVED" ? (
                          <DismissInline alertId={a.id} reasons={reasons.filter((r) => r.category === "ALERT_DISMISS")} />
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="empty">No alerts on this case. It was opened by {c.type === "UNDERWRITING" ? "an application" : "a person or a scheduled review"}.</div>
            )}
            {c.type === "UNDERWRITING" && app ? (
              <Link className="btn" style={{ marginTop: 12 }} href={`/applications/${app.id}`}>Open the underwriting review</Link>
            ) : null}
          </section>
          {series.some((r) => r.attempts > 0) ? <MetricsChart rows={series} markers={markers} vampLine={policy.params.network.visa.merchantExcessiveBps / 10_000} networkLabel={policy.params.network.label} /> : null}

        <section className="panel" aria-labelledby="tl-h">
          <header>
            <h2 id="tl-h">Timeline</h2>
            <span className="meta">{c.events.length} events</span>
          </header>
          {canWork ? <NoteBox caseId={c.id} users={users.filter((u) => u.role !== "MERCHANT").map((u) => u.name)} /> : null}
          <ol className="timeline" style={{ marginTop: 8 }}>
            {[...c.events].reverse().map((e) => {
              const p = e.payload as Record<string, unknown>;
              return (
                <li key={e.id} style={{ gridTemplateColumns: "84px minmax(0,1fr)" }}>
                  <div className="num muted" style={{ fontSize: 12 }}>
                    {fmtDate(e.createdAt, tz)}
                    <div>{fmtTime(e.createdAt, tz)}</div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 500 }}>{eventTitle(e.type, p, name)}</div>
                    {typeof p.body === "string" ? <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{p.body}</div> : null}
                    {typeof p.note === "string" && p.note ? <div className="muted">“{p.note}”</div> : null}
                    {typeof p.summary === "string" ? <div className="muted">{p.summary}</div> : null}
                    <div className="meta">{e.actorId ? name.get(e.actorId) : "System"}</div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
        </div>

        <CaseActions
          caseId={c.id}
          merchantId={m.id}
          merchantName={m.dbaName ?? m.legalName}
          status={c.status}
          assigneeId={c.assigneeId}
          me={{ id: user.id }}
          users={users.filter((u) => ["ANALYST", "SENIOR_ANALYST", "RISK_MANAGER", "COMPLIANCE"].includes(u.role)).map((u) => ({ id: u.id, name: u.name }))}
          canWork={canWork}
          canPropose={can(user.role, "control.propose")}
          processing={["ACTIVE", "UNDER_REVIEW", "RESTRICTED"].includes(m.status)}
          reasons={reasons}
          today={isoDay(today)}
          pendingApproval={pendingApproval ? { id: pendingApproval.id, summary: pendingApproval.summary ?? "", requestedBy: name.get(pendingApproval.requestedById) ?? "", at: fmtDate(pendingApproval.createdAt, tz) } : null}
          openRfi={openRfi ? { items: (openRfi.items as { label: string; status: string }[]).map((i) => ({ label: i.label, status: i.status })), dueAt: fmtDate(openRfi.dueAt, tz), status: openRfi.status } : null}
          controlsSummary={controls.map((x) => `${CONTROL_LABEL[x.type]}: ${controlSummary(x.type, x.params as Record<string, unknown>, m.currency)}${x.status === "PENDING_APPROVAL" ? " (awaiting approval)" : ""}`)}
        />
      </div>
    </>
  );
}

function eventTitle(type: string, p: Record<string, unknown>, name: Map<string, string>): string {
  const lc = (v: unknown) => String(v ?? "").toLowerCase().replace(/_/g, " ");
  switch (type) {
    case "CREATED":
      return "Case opened";
    case "ASSIGNED":
      return `Assigned to ${p.toName ?? name.get(String(p.to)) ?? "someone"}`;
    case "STATUS_CHANGE":
      return p.to && p.from ? `${lc(p.from)} → ${lc(p.to)}` : p.priority ? `Priority raised to ${lc((p.priority as { to: string }).to)}` : "Status changed";
    case "ALERT_LINKED":
      return `Alert linked: ${p.ruleKey}`;
    case "RFI_SENT":
      return `Documents requested (${(p.items as string[] | undefined)?.length ?? 0}), due ${String(p.dueAt ?? "").slice(0, 10)}`;
    case "RFI_ANSWERED":
      return "Merchant sent everything requested";
    case "CONTROL_PROPOSED":
      return `${p.needsApproval ? "Control proposed" : "Control applied"}: ${p.summary ?? lc(p.type)}`;
    case "DECISION":
      return p.decision ? `Decision: ${lc(p.decision)}` : "Decision";
    case "BAND_CHANGE":
      return `Risk band ${lc(p.from)} → ${lc(p.to)} (score ${p.score})`;
    case "NOTE":
      return "Note";
    default:
      return lc(type);
  }
}

/** Evidence in the rule's own order: the metrics its condition reads, then the extras it lists. */
function orderedEvidence(metrics: Record<string, number | null>, order: string[]): [string, number | null][] {
  const seen = new Set<string>();
  const out: [string, number | null][] = [];
  for (const k of [...order, ...Object.keys(metrics)]) {
    if (seen.has(k) || !(k in metrics)) continue;
    seen.add(k);
    out.push([k, metrics[k]]);
  }
  return out;
}
