import Link from "next/link";
import { notFound } from "next/navigation";
import type { Prisma, Severity, CaseType } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStaff, viewerTz } from "@/lib/session";
import { now } from "@/lib/clock";
import { can } from "@/lib/auth/rbac";
import { QUEUES, caseWhere, applicationWhere, type QueueKey } from "@/lib/queries/queues";
import { BandPill, SeverityPill, SlaText, Avatar, MerchantStatusPill } from "@/components/ui/badges";
import { RowLink } from "@/components/ui/RowLink";
import { AssignToMe, BulkAssign } from "@/components/cases/QueueActions";
import { AlertRowActions } from "@/components/cases/AlertActions";
import { CASE_STATUS_LABEL } from "@/lib/domain/caseStateMachine";
import { fmtAgo, fmtDate, humanize } from "@/lib/format";
import { missingItems, type Checklist } from "@/lib/domain/underwriting/checklist";
import { METRICS, type MetricKey } from "@/lib/domain/rules/dsl";
import { valueLabel } from "@/components/charts/scale";
import { SavedView } from "@/components/cases/SavedView";

const PRIORITY_RANK: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const TYPES: CaseType[] = ["MONITORING", "DISPUTE_SPIKE", "WATCHLIST", "UNDERWRITING", "RFI_FOLLOWUP", "OFFBOARDING"];

export async function generateMetadata({ params }: { params: Promise<{ queue: string }> }) {
  const { queue } = await params;
  return { title: QUEUES[queue as QueueKey]?.label ?? "Queue" };
}

export default async function QueuePage({ params, searchParams }: { params: Promise<{ queue: string }>; searchParams: Promise<{ type?: string; priority?: string }> }) {
  const { queue } = await params;
  const sp = await searchParams;
  if (!(queue in QUEUES)) notFound();
  const q = queue as QueueKey;
  const user = await requireStaff();
  const [tz, at, users] = await Promise.all([viewerTz(), now(), db.user.findMany({ where: { role: { in: ["ANALYST", "SENIOR_ANALYST", "RISK_MANAGER", "COMPLIANCE"] }, active: true }, select: { id: true, name: true } })]);
  const name = new Map(users.map((u) => [u.id, u.name]));
  const canWork = can(user.role, "case.work");
  const meta = QUEUES[q];

  if (q === "alerts-untriaged") {
    const alerts = await db.alert.findMany({ where: { status: "OPEN" }, include: { merchant: { select: { id: true, dbaName: true, legalName: true, currentBand: true, currentScore: true } } }, orderBy: [{ createdAt: "desc" }] });
    alerts.sort((a, b) => PRIORITY_RANK[a.severity] - PRIORITY_RANK[b.severity]);
    const reasons = await db.reasonCode.findMany({ where: { category: "ALERT_DISMISS", active: true } });
    return (
      <>
        <Title label={meta.label} sub="Alerts whose rule does not open a case by itself. Open a case or dismiss with a reason; dismissals feed each rule's precision." count={alerts.length} noun="alert" />
        <section className="panel flush">
          {alerts.length ? (
            <div className="table-wrap">
              <table className="data responsive-table">
                <thead>
                  <tr>
                    <th>Merchant</th>
                    <th>Rule</th>
                    <th>Severity</th>
                    <th>Evidence</th>
                    <th className="n">Raised</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((a) => {
                    const ev = (a.evidence as { metrics?: Record<string, number | null> }).metrics ?? {};
                    return (
                      <tr key={a.id} data-row tabIndex={0} data-href={`/merchants/${a.merchant.id}`}>
                        <td>
                          <Link className="link" href={`/merchants/${a.merchant.id}`}>{a.merchant.dbaName ?? a.merchant.legalName}</Link>
                          <span className="sub"><BandPill band={a.merchant.currentBand} score={a.merchant.currentScore} /></span>
                        </td>
                        <td className="id">{a.ruleKey}</td>
                        <td><SeverityPill severity={a.severity} /></td>
                        <td data-line2 style={{ fontSize: 13 }}>
                          {Object.entries(ev).slice(0, 2).map(([k, v]) => (
                            <span key={k} style={{ display: "block" }}>
                              <span className="muted">{METRICS[k as MetricKey]?.label ?? k}: </span>
                              <span className="num">{valueLabel(v, METRICS[k as MetricKey]?.unit === "money" ? "money" : METRICS[k as MetricKey]?.unit === "ratio" ? "ratio" : "count")}</span>
                            </span>
                          ))}
                        </td>
                        <td className="n num">{fmtDate(a.metricDate, "UTC")}</td>
                        <td className="n">{canWork ? <AlertRowActions alertId={a.id} merchantId={a.merchant.id} reasons={reasons} /> : null}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: 20 }}><div className="empty">{meta.empty}</div></div>
          )}
        </section>
      </>
    );
  }

  const appWhere = applicationWhere(q);
  if (appWhere) {
    const merchants = await db.merchant.findMany({
      where: appWhere,
      include: { applications: { orderBy: { submittedAt: "desc" }, take: 1 }, cases: { where: { type: "UNDERWRITING", status: { not: "RESOLVED" } }, take: 1 }, owners: { select: { screeningStatus: true } } },
    });
    merchants.sort((a, b) => (a.applications[0]?.submittedAt?.getTime() ?? 0) - (b.applications[0]?.submittedAt?.getTime() ?? 0));
    return (
      <>
        <Title label={meta.label} sub={q === "underwriting-enhanced" ? "High-risk and hard-stop applications; decided by a senior underwriter or the head of risk. Oldest first." : "Low and medium risk; any analyst can decide. Medium is marked amber. Oldest first."} count={merchants.length} noun="application" />
        <section className="panel flush">
          {merchants.length ? (
            <div className="table-wrap">
              <table className="data responsive-table">
                <thead>
                  <tr>
                    <th style={{ width: "32%" }}>Merchant</th>
                    <th>Risk</th>
                    <th>Status</th>
                    <th className="n">Checklist</th>
                    <th>Owner</th>
                    <th className="n">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {merchants.map((m) => {
                    const app = m.applications[0];
                    const cl = app?.checklist as unknown as Checklist | undefined;
                    const req = cl?.items.filter((i) => i.required).length ?? 0;
                    const miss = cl ? missingItems(cl).length : 0;
                    const owner = m.cases[0]?.assigneeId;
                    return (
                      <RowLink key={m.id} href={`/applications/${app?.id}`} testId={`app-row-${m.registrationNo}`}>
                        <td>
                          <Link className="link" href={`/applications/${app?.id}`} tabIndex={-1}>{m.dbaName ?? m.legalName}</Link>
                          <span className="sub">
                            {m.owners.some((o) => o.screeningStatus === "POTENTIAL_MATCH") ? "Possible watchlist match · " : ""}
                            {m.registrationNo}
                          </span>
                        </td>
                        <td><BandPill band={m.currentBand} score={m.currentScore} /></td>
                        <td data-line2><MerchantStatusPill status={m.status} /></td>
                        <td className="n num">{req - miss}<span className="muted"> /{req}</span></td>
                        <td data-hide-phone>{owner ? <span className="row-gap"><Avatar name={name.get(owner) ?? "?"} size={20} />{name.get(owner)}</span> : <span className="muted">Unassigned</span>}</td>
                        <td className="n">{app?.submittedAt ? fmtAgo(app.submittedAt, at) : "—"}</td>
                      </RowLink>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: 20 }}><div className="empty">{meta.empty}</div></div>
          )}
        </section>
      </>
    );
  }

  const base = (await caseWhere(q, user))!;
  const where: Prisma.CaseWhereInput = { ...base };
  if (sp.type && TYPES.includes(sp.type as CaseType)) where.type = sp.type as CaseType;
  if (sp.priority && sp.priority in PRIORITY_RANK) where.priority = sp.priority as Severity;
  const cases = await db.case.findMany({
    where,
    include: { merchant: { select: { id: true, dbaName: true, legalName: true, currentBand: true, currentScore: true } }, _count: { select: { alerts: true } } },
  });
  // Unassigned: priority then SLA; everything else: nearest SLA first (PRD §6.4).
  cases.sort((a, b) => (q === "unassigned" ? PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] : 0) || a.slaDueAt.getTime() - b.slaDueAt.getTime());
  const qs = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ type: sp.type, priority: sp.priority, ...o }).filter(([, v]) => v) as [string, string][]);
    return `/queues/${q}${p.size ? `?${p}` : ""}`;
  };
  const showBulk = canWork && (q === "unassigned" || q === "breaching-sla");
  return (
    <>
      <Title
        label={meta.label}
        sub={q === "unassigned" ? "Sorted by priority, then the nearest SLA." : q === "breaching-sla" ? "Past their SLA or due within two hours. Nearest first." : "Nearest SLA first."}
        count={cases.length}
        noun="case"
      />
      <div className="row-gap" style={{ marginBottom: 12, justifyContent: "space-between" }}>
        <div className="row-gap">
          <div className="segmented" role="group" aria-label="Priority">
            <Link href={qs({ priority: undefined })} aria-current={!sp.priority ? "true" : undefined}>Any priority</Link>
            {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as Severity[]).map((p) => (
              <Link key={p} href={qs({ priority: p })} aria-current={sp.priority === p ? "true" : undefined}>{humanize(p)}</Link>
            ))}
          </div>
          <div className="segmented" role="group" aria-label="Type">
            <Link href={qs({ type: undefined })} aria-current={!sp.type ? "true" : undefined}>Any type</Link>
            {TYPES.filter((t) => t !== "RFI_FOLLOWUP").map((t) => (
              <Link key={t} href={qs({ type: t })} aria-current={sp.type === t ? "true" : undefined}>{humanize(t).replace("Dispute spike", "Disputes")}</Link>
            ))}
          </div>
        </div>
        <SavedView queue={q} current={{ type: sp.type, priority: sp.priority }} />
      </div>
      <section className="panel flush">
        {cases.length ? (
          <form id="bulk">
            {showBulk ? <BulkAssign users={users} /> : null}
            <div className="table-wrap">
              <table className="data responsive-table" data-keynav>
                <thead>
                  <tr>
                    {showBulk ? <th style={{ width: 36 }}><span className="sr-only">Select</span></th> : null}
                    <th style={{ width: "30%" }}>Merchant</th>
                    <th>Priority</th>
                    <th>SLA</th>
                    <th>Status</th>
                    <th>Risk</th>
                    <th>Owner</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {cases.map((c) => {
                    const breached = c.slaDueAt < at;
                    return (
                      <RowLink key={c.id} href={`/cases/${c.id}`} testId={`case-row-${c.id}`}>
                        {showBulk ? (
                          <td>
                            <input type="checkbox" name="caseId" value={c.id} aria-label={`Select ${c.merchant.dbaName ?? c.merchant.legalName}`} />
                          </td>
                        ) : null}
                        <td style={breached ? { boxShadow: "inset 3px 0 0 var(--negative)" } : undefined}>
                          <Link className="link" href={`/cases/${c.id}`} tabIndex={-1}>{c.merchant.dbaName ?? c.merchant.legalName}</Link>
                          <span className="sub">{c.title ?? humanize(c.type)} · {humanize(c.type)}{c._count.alerts ? ` · ${c._count.alerts} alerts` : ""}</span>
                        </td>
                        <td><SeverityPill severity={c.priority} /></td>
                        <td data-line2><SlaText due={c.slaDueAt} now={at} /></td>
                        <td data-hide-phone>{CASE_STATUS_LABEL[c.status]}</td>
                        <td data-hide-phone><BandPill band={c.merchant.currentBand} score={c.merchant.currentScore} /></td>
                        <td data-hide-phone>{c.assigneeId ? <span className="row-gap" style={{ flexWrap: "nowrap" }}><Avatar name={name.get(c.assigneeId) ?? "?"} size={20} /><span className="truncate">{name.get(c.assigneeId)}</span></span> : <span className="muted">Unassigned</span>}</td>
                        <td className="n">{canWork && c.assigneeId !== user.id && c.status !== "RESOLVED" ? <AssignToMe caseId={c.id} userId={user.id} /> : null}</td>
                      </RowLink>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </form>
        ) : (
          <div style={{ padding: 20 }}><div className="empty">{sp.type || sp.priority ? "No cases match these filters." : meta.empty}</div></div>
        )}
      </section>
      <p className="meta" style={{ marginTop: 10 }}>
        Keyboard: <span className="kbd">j</span> <span className="kbd">k</span> move, <span className="kbd">Enter</span> open, <span className="kbd">a</span> assign to me, <span className="kbd">?</span> all shortcuts.
      </p>
    </>
  );
}

function Title({ label, sub, count, noun }: { label: string; sub: string; count: number; noun: string }) {
  return (
    <div className="title-row">
      <div>
        <h1>{label}</h1>
        <div className="sub">{sub}</div>
      </div>
      <span className="muted num">{count} {noun}{count === 1 ? "" : "s"}</span>
    </div>
  );
}
