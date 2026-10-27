import Link from "next/link";
import { db } from "@/lib/db";
import { requireStaff, viewerTz } from "@/lib/session";
import { pendingApprovalsFor } from "@/lib/queries/queues";
import { approverRolesFor } from "@/lib/domain/approvals/policy";
import { previewControl, reserveBalances } from "@/lib/domain/controls/service";
import { getActivePolicy } from "@/lib/domain/policy";
import { simToday } from "@/lib/clock";
import { addDays } from "@/lib/domain/reserves/calc";
import { formatMoney } from "@/lib/money";
import { fmtDate, fmtTime, humanize } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/auth/rbac";
import { Avatar, BandPill, SeverityPill } from "@/components/ui/badges";
import { ApprovalDecision } from "@/components/approvals/ApprovalDecision";
import { TimeSeries } from "@/components/charts/TimeSeries";
import { CONTROL_LABEL, controlSummary } from "@/lib/domain/controls/text";
import { METRICS, type MetricKey } from "@/lib/domain/rules/dsl";
import { valueLabel } from "@/components/charts/scale";
import { TERMINATION_CATEGORIES } from "@/lib/domain/offboarding/service";

export const metadata = { title: "Approvals" };

const ACTION: Record<string, string> = {
  APPLY_CONTROL: "Apply a control",
  TERMINATE: "Terminate a merchant",
  OVERRIDE_PROHIBITED: "Override a hard stop",
  REMOVE_RESERVE: "Remove a reserve",
  REMOVE_CONTROL: "Remove a control",
};

/** "Should I approve this, and what happens if I do?" (DESIGN.md §3) */
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ id?: string; view?: string }> }) {
  const sp = await searchParams;
  const user = await requireStaff();
  const tz = await viewerTz();
  const view = sp.view === "mine" ? "mine" : sp.view === "decided" ? "decided" : "inbox";
  const [inbox, mine, decided, users] = await Promise.all([
    pendingApprovalsFor(user),
    db.approvalRequest.findMany({ where: { requestedById: user.id }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.approvalRequest.findMany({ where: { status: { in: ["APPROVED", "REJECTED", "CANCELLED"] } }, orderBy: { decidedAt: "desc" }, take: 50 }),
    db.user.findMany({ select: { id: true, name: true, role: true } }),
  ]);
  const list = view === "mine" ? mine : view === "decided" ? decided : inbox;
  const name = new Map(users.map((u) => [u.id, u.name]));
  const selectedId = sp.id ?? list[0]?.id;
  const sel = selectedId ? await db.approvalRequest.findUnique({ where: { id: selectedId } }) : null;
  const merchants = new Map((await db.merchant.findMany({ where: { id: { in: [...list, ...(sel ? [sel] : [])].map((r) => r.merchantId).filter(Boolean) as string[] } }, select: { id: true, dbaName: true, legalName: true, currentBand: true, currentScore: true, currency: true } })).map((m) => [m.id, m]));
  const qs = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ view: sp.view, ...o }).filter(([, v]) => v) as [string, string][]);
    return `/approvals${p.size ? `?${p}` : ""}`;
  };

  return (
    <>
      <div className="title-row">
        <div>
          <h1>Approvals</h1>
          <div className="sub">Actions over the four-eyes line wait here. Nothing happens to the merchant until a second, authorised person approves.</div>
        </div>
      </div>
      <nav className="tabs" aria-label="Approval views">
        <Link href="/approvals" aria-current={view === "inbox" ? "page" : undefined}>Waiting for me<span className="count">{inbox.length}</span></Link>
        <Link href="/approvals?view=mine" aria-current={view === "mine" ? "page" : undefined}>My requests<span className="count">{mine.filter((m) => m.status === "PENDING").length}</span></Link>
        <Link href="/approvals?view=decided" aria-current={view === "decided" ? "page" : undefined}>Decided</Link>
      </nav>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 360px) minmax(0, 1fr)", gap: 16, alignItems: "start" }} className="approvals-grid">
        <section className="panel flush" aria-label="Requests">
          {list.length ? (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {list.map((r, i) => {
                const m = r.merchantId ? merchants.get(r.merchantId) : null;
                const active = r.id === selectedId;
                return (
                  <li key={r.id} style={{ borderTop: i ? "1px solid var(--rule)" : 0 }}>
                    <Link href={qs({ id: r.id })} aria-current={active ? "true" : undefined} data-testid={`approval-${r.actionType}`} style={{ display: "block", padding: "12px 16px", background: active ? "var(--active)" : undefined }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <strong style={{ fontWeight: 600 }} className="truncate">{m ? m.dbaName ?? m.legalName : "—"}</strong>
                        <span className="meta num" style={{ flex: "none" }}>{fmtDate(r.createdAt, tz)}</span>
                      </div>
                      <div style={{ fontSize: 13 }}>{ACTION[r.actionType] ?? humanize(r.actionType)}</div>
                      <div className="meta truncate">
                        {view === "inbox" ? `From ${name.get(r.requestedById)}` : r.status === "PENDING" ? `Waiting for ${approverRolesFor(r.actionType, r.payload as never).map((x) => ROLE_LABEL[x].toLowerCase()).join(" or ")}` : `${humanize(r.status)} by ${r.decidedById ? name.get(r.decidedById) : "—"}`}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div style={{ padding: 16 }}>
              <div className="empty">{view === "inbox" ? "Nothing is waiting for you." : view === "mine" ? "You have not requested anything." : "No decided requests yet."}</div>
            </div>
          )}
        </section>
        {sel ? <Detail req={sel} user={user} tz={tz} name={name} merchant={sel.merchantId ? merchants.get(sel.merchantId) ?? null : null} /> : <section className="panel"><div className="empty">Select a request.</div></section>}
      </div>
    </>
  );
}

async function Detail({
  req,
  user,
  tz,
  name,
  merchant,
}: {
  req: NonNullable<Awaited<ReturnType<typeof db.approvalRequest.findUnique>>>;
  user: { id: string; role: string };
  tz: string;
  name: Map<string, string>;
  merchant: { id: string; dbaName: string | null; legalName: string; currentBand: string | null; currentScore: number | null; currency: string } | null;
}) {
  const p = req.payload as Record<string, unknown>;
  const allowed = approverRolesFor(req.actionType, p as never);
  const mine = req.requestedById === user.id;
  const canDecide = req.status === "PENDING" && !mine && allowed.includes(user.role as never);
  const currency = merchant?.currency ?? "USD";
  const policy = await getActivePolicy();
  const today = await simToday();
  const [caseRow, preview, bal, rc] = await Promise.all([
    req.caseId ? db.case.findUnique({ where: { id: req.caseId }, include: { alerts: { orderBy: { metricDate: "desc" }, take: 4 } } }) : null,
    req.actionType === "APPLY_CONTROL" && req.status === "PENDING" && merchant
      ? db.control.findUnique({ where: { id: String(p.controlId) } }).then((c) =>
          c ? previewControl({ merchantId: merchant.id, type: c.type, params: c.params as Record<string, unknown>, reasonCode: c.reasonCode, reviewAt: c.reviewAt.toISOString().slice(0, 10) }).then((pv) => ({ pv, c })) : null,
        )
      : null,
    merchant ? reserveBalances(merchant.id) : null,
    p.reasonCode ? db.reasonCode.findUnique({ where: { code: String(p.reasonCode) } }) : null,
  ]);
  const consequence = (() => {
    switch (req.actionType) {
      case "APPLY_CONTROL":
        return preview
          ? [`${CONTROL_LABEL[preview.c.type]} starts today: ${controlSummary(preview.c.type, preview.c.params as Record<string, unknown>, currency)}.`, `Over 90 days ${formatMoney(BigInt(preview.pv.after.notReceived) - BigInt(preview.pv.before.notReceived), currency)} is not paid out to the merchant; the reserve reaches ${formatMoney(preview.pv.after.endBalance, currency)}.`, `The merchant moves to Restricted if under review, and a review case opens on ${fmtDate(preview.c.reviewAt, tz)}.`]
          : [String(req.summary)];
      case "TERMINATE":
        return [
          "Card processing stops today and the merchant moves to Termination pending.",
          `${formatMoney(bal?.total ?? 0n, currency)} of reserve stays held until ${fmtDate(addDays(today, policy.params.disputeWindowDays), tz)} (${policy.params.disputeWindowDays}-day dispute window), then losses are applied and the rest is paid out.`,
          p.addToTerminatedList ? "The merchant and its main owners are added to the terminated merchant list." : "The merchant is not added to the terminated merchant list.",
        ];
      case "REMOVE_RESERVE":
        return [`The reserve control comes off and its balance is paid out to the merchant (merchant total ${formatMoney(bal?.total ?? 0n, currency)}).`, "If no other heavy control remains, the merchant returns to Active."];
      case "REMOVE_CONTROL":
        return ["The control comes off today.", "If no other heavy control remains, the merchant returns to Active."];
      case "OVERRIDE_PROHIBITED":
        return [`The application is ${humanize(String(p.decision))} despite a hard stop.`, "Use only with documented evidence that the hard stop does not apply."];
      default:
        return [String(req.summary)];
    }
  })();
  return (
    <section className="panel" aria-labelledby="ap-h" data-testid="approval-detail">
      <header style={{ alignItems: "flex-start" }}>
        <div>
          <h2 id="ap-h">{ACTION[req.actionType] ?? humanize(req.actionType)}</h2>
          <div className="meta">
            {merchant ? <Link className="link" href={`/merchants/${merchant.id}`}>{merchant.dbaName ?? merchant.legalName}</Link> : null}
            {merchant?.currentBand ? <> · <BandPill band={merchant.currentBand as never} score={merchant.currentScore} /></> : null}
          </div>
        </div>
        <span className={`pill ${req.status === "PENDING" ? "warn" : req.status === "APPROVED" ? "" : "outline"}`}>{humanize(req.status)}</span>
      </header>

      <div className="row-gap" style={{ marginBottom: 14 }}>
        <Avatar name={name.get(req.requestedById) ?? "?"} />
        <span>
          Requested by <strong style={{ fontWeight: 500 }}>{name.get(req.requestedById)}</strong> on {fmtDate(req.createdAt, tz)} at {fmtTime(req.createdAt, tz)}
        </span>
      </div>

      <h3 style={{ marginBottom: 6 }}>If you approve</h3>
      <ul style={{ margin: "0 0 16px", paddingLeft: 18 }} data-testid="consequences">
        {consequence.map((c, i) => (
          <li key={i} style={{ marginBottom: 4 }}>{c}</li>
        ))}
      </ul>

      {req.actionType === "TERMINATE" ? (
        <dl className="kv" style={{ marginBottom: 16 }}>
          <dt>Reason</dt>
          <dd>{TERMINATION_CATEGORIES[p.reasonCategory as keyof typeof TERMINATION_CATEGORIES]?.label ?? String(p.reasonCategory)}</dd>
          <dt>Evidence from the requester</dt>
          <dd style={{ textAlign: "left" }}>{String(p.note ?? "")}</dd>
        </dl>
      ) : null}
      {rc?.merchantFacingText ? (
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 6 }}>The merchant will read</h3>
          <blockquote style={{ margin: 0, padding: "10px 12px", background: "var(--raised)", borderRadius: 6, border: "1px solid var(--border)" }}>{preview?.pv.merchantText ?? rc.merchantFacingText}</blockquote>
        </div>
      ) : preview ? (
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 6 }}>The merchant will read</h3>
          <blockquote style={{ margin: 0, padding: "10px 12px", background: "var(--raised)", borderRadius: 6, border: "1px solid var(--border)" }}>{preview.pv.merchantText}</blockquote>
          <div className="meta" style={{ marginTop: 4 }}>Requester&apos;s note: “{preview.c.note}”</div>
        </div>
      ) : null}

      {preview ? (
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 6 }}>Projected reserve, next 90 days</h3>
          <TimeSeries label="Projected reserve balance" fmt="money" height={170} data={preview.pv.after.days.map((d, i) => ({ date: d.date, value: Number(d.balance), compare: Number(preview.pv.before.days[i]?.balance ?? 0) }))} compareLabel="Without this control" />
          <div className="meta">Exposure covered after 90 days: {(preview.pv.coverageAfter90 * 100).toFixed(0)}% (now {(preview.pv.coverageNow * 100).toFixed(0)}%)</div>
        </div>
      ) : null}

      {caseRow ? (
        <div style={{ marginBottom: 16 }}>
          <div className="row-gap" style={{ justifyContent: "space-between", marginBottom: 6 }}>
            <h3>Evidence from the case</h3>
            <Link className="link meta" href={`/cases/${caseRow.id}`}>Open case</Link>
          </div>
          {caseRow.alerts.length ? (
            <div className="list-rows">
              {caseRow.alerts.map((a) => {
                const ev = (a.evidence as { metrics?: Record<string, number | null> }).metrics ?? {};
                return (
                  <div key={a.id} style={{ padding: "8px 0" }}>
                    <div className="row-gap"><SeverityPill severity={a.severity} /><span className="id">{a.ruleKey}</span><span className="meta">{fmtDate(a.metricDate, "UTC")}</span></div>
                    <div className="meta" style={{ marginTop: 2 }}>
                      {Object.entries(ev).slice(0, 3).map(([k, v]) => `${METRICS[k as MetricKey]?.label ?? k}: ${valueLabel(v, METRICS[k as MetricKey]?.unit === "money" ? "money" : METRICS[k as MetricKey]?.unit === "ratio" ? "ratio" : "count")}`).join(" · ")}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="meta">{caseRow.title}</div>
          )}
        </div>
      ) : null}

      {req.status !== "PENDING" ? (
        <div className="notice info">
          {humanize(req.status)} by {req.decidedById ? name.get(req.decidedById) : "the requester"} {req.decidedAt ? `on ${fmtDate(req.decidedAt, tz)}` : ""}. {req.decisionNote ? `“${req.decisionNote}”` : ""}
        </div>
      ) : (
        <ApprovalDecision approvalId={req.id} canDecide={canDecide} isRequester={mine} waitingFor={allowed.map((r) => ROLE_LABEL[r].toLowerCase()).join(" or ")} />
      )}
    </section>
  );
}
