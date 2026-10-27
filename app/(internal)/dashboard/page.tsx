import Link from "next/link";
import { db } from "@/lib/db";
import { requireStaff, viewerTz } from "@/lib/session";
import { now, simToday } from "@/lib/clock";
import { can } from "@/lib/auth/rbac";
import { OPEN_CASE_STATES, CASE_STATUS_LABEL } from "@/lib/domain/caseStateMachine";
import { pendingApprovalsFor, applicationWhere } from "@/lib/queries/queues";
import { addDays } from "@/lib/domain/reserves/calc";
import { fmtDate, fmtDateTime, humanize, fmtAgo } from "@/lib/format";
import { BandPill, SeverityPill, SlaText } from "@/components/ui/badges";
import { RowLink } from "@/components/ui/RowLink";
import { CONTROL_LABEL } from "@/lib/domain/controls/text";
import { MarkRead } from "@/components/shell/MarkRead";

export const metadata = { title: "Dashboard" };

const ACTION: Record<string, string> = { APPLY_CONTROL: "Apply a control", TERMINATE: "Terminate", OVERRIDE_PROHIBITED: "Override a hard stop", REMOVE_RESERVE: "Remove a reserve", REMOVE_CONTROL: "Remove a control" };

/** "What needs me today?" — the same frame for every role, filled with that role's work (PRD §9). */
export default async function Dashboard() {
  const user = await requireStaff();
  const [tz, at, today] = await Promise.all([viewerTz(), now(), simToday()]);
  const works = can(user.role, "case.work");
  const [mine, approvals, notes, controlsDue, std, enh, hits, jobs, lastVerify, myRequests] = await Promise.all([
    works ? db.case.findMany({ where: { assigneeId: user.id, status: { in: OPEN_CASE_STATES } }, include: { merchant: { select: { dbaName: true, legalName: true, currentBand: true, currentScore: true } } }, orderBy: { slaDueAt: "asc" } }) : [],
    pendingApprovalsFor(user),
    db.notification.findMany({ where: { readAt: null, OR: [{ userId: user.id }, { role: user.role, userId: null }] }, orderBy: { createdAt: "desc" }, take: 6 }),
    db.control.findMany({ where: { status: "ACTIVE", reviewAt: { lte: addDays(today, 14) } }, include: { merchant: { select: { id: true, dbaName: true, legalName: true } } }, orderBy: { reviewAt: "asc" }, take: 5 }),
    can(user.role, "underwriting.decide.standard") ? db.merchant.count({ where: applicationWhere("underwriting-standard")! }) : 0,
    can(user.role, "underwriting.decide.high") ? db.merchant.count({ where: applicationWhere("underwriting-enhanced")! }) : 0,
    user.role === "COMPLIANCE" ? db.watchlistHit.count({ where: { status: "PENDING_REVIEW" } }) : 0,
    user.role === "ADMIN" || user.role === "AUDITOR" ? db.jobRun.findMany({ orderBy: { startedAt: "desc" }, take: 6 }) : [],
    db.auditLog.findFirst({ where: { action: "AUDIT_VERIFIED" }, orderBy: { id: "desc" } }),
    db.approvalRequest.findMany({ where: { requestedById: user.id, status: "PENDING" } }),
  ]);
  const breached = mine.filter((c) => c.slaDueAt < at);
  const merchants = new Map((await db.merchant.findMany({ where: { id: { in: approvals.map((a) => a.merchantId).filter(Boolean) as string[] } }, select: { id: true, dbaName: true, legalName: true } })).map((m) => [m.id, m.dbaName ?? m.legalName]));
  const users = new Map((await db.user.findMany({ select: { id: true, name: true } })).map((u) => [u.id, u.name]));

  const parts: string[] = [];
  if (works) parts.push(breached.length ? `${breached.length} of your ${mine.length} cases ${breached.length === 1 ? "is" : "are"} past SLA` : mine.length ? `${mine.length} cases are yours, none past SLA` : "No cases are assigned to you");
  if (approvals.length) parts.push(`${approvals.length} approval${approvals.length === 1 ? "" : "s"} wait${approvals.length === 1 ? "s" : ""} for you`);
  if (std + enh) parts.push(`${std + enh} application${std + enh === 1 ? "" : "s"} to decide`);
  if (hits) parts.push(`${hits} watchlist match${hits === 1 ? "" : "es"} to review`);
  const next = mine[0];

  return (
    <>
      <div className="title-row">
        <div>
          <h1>Today</h1>
          <div className="sub" data-testid="dashboard-finding">{parts.join(" · ") || "Nothing needs you right now."}</div>
        </div>
        {next ? <Link className="btn primary" href={`/cases/${next.id}`}>Open next case</Link> : approvals[0] ? <Link className="btn primary" href={`/approvals?id=${approvals[0].id}`}>Review next approval</Link> : null}
      </div>

      <div className="grid-2-1">
        <div className="col">
          {approvals.length ? (
            <section className="panel flush" aria-labelledby="ap-h" data-testid="dash-approvals">
              <header><h2 id="ap-h">Waiting for your approval</h2><Link className="link meta" href="/approvals">All</Link></header>
              <div className="table-wrap" style={{ marginTop: 8 }}>
                <table className="data">
                  <tbody>
                    {approvals.slice(0, 5).map((a) => (
                      <RowLink key={a.id} href={`/approvals?id=${a.id}`}>
                        <td>{a.merchantId ? merchants.get(a.merchantId) : "—"}<span className="sub">{ACTION[a.actionType] ?? a.actionType} · from {users.get(a.requestedById)}</span></td>
                        <td className="n">{fmtAgo(a.createdAt, at)}</td>
                      </RowLink>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
          {works ? (
            <section className="panel flush" aria-labelledby="my-h">
              <header><h2 id="my-h">Your cases</h2><Link className="link meta" href="/queues/my-work">All {mine.length}</Link></header>
              {mine.length ? (
                <div className="table-wrap" style={{ marginTop: 8 }}>
                  <table className="data responsive-table" data-keynav>
                    <thead><tr><th style={{ width: "40%" }}>Merchant</th><th>Priority</th><th>SLA</th><th>Status</th><th>Risk</th></tr></thead>
                    <tbody>
                      {mine.slice(0, 6).map((c) => (
                        <RowLink key={c.id} href={`/cases/${c.id}`}>
                          <td><Link className="link" href={`/cases/${c.id}`} tabIndex={-1}>{c.merchant.dbaName ?? c.merchant.legalName}</Link><span className="sub">{c.title ?? humanize(c.type)}</span></td>
                          <td><SeverityPill severity={c.priority} /></td>
                          <td data-line2><SlaText due={c.slaDueAt} now={at} /></td>
                          <td data-hide-phone>{CASE_STATUS_LABEL[c.status]}</td>
                          <td data-hide-phone><BandPill band={c.merchant.currentBand} score={c.merchant.currentScore} /></td>
                        </RowLink>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ padding: "8px 20px 20px" }}><div className="empty"><span>Nothing assigned to you. <Link className="link" href="/queues/unassigned">Pick up an unassigned case</Link></span></div></div>
              )}
            </section>
          ) : null}
          {jobs.length ? (
            <section className="panel flush" aria-labelledby="jobs-h">
              <header><h2 id="jobs-h">Background jobs</h2><span className="meta">Latest runs</span></header>
              <div className="table-wrap" style={{ marginTop: 8 }}>
                <table className="data">
                  <thead><tr><th>Job</th><th>Result</th><th className="n">Items</th><th className="n">Duration</th><th className="n">Started</th></tr></thead>
                  <tbody>
                    {jobs.map((j) => (
                      <tr key={j.id}>
                        <td className="id">{j.name}</td>
                        <td>{j.ok ? <span className="pill">OK</span> : <span className="pill neg" title={j.error ?? ""}>Failed</span>}</td>
                        <td className="n num">{j.items ?? "—"}</td>
                        <td className="n num">{j.durationMs !== null ? `${j.durationMs} ms` : "—"}</td>
                        <td className="n num">{fmtDateTime(j.startedAt, tz)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
          {user.role === "AUDITOR" || user.role === "ADMIN" ? (
            <section className="panel" aria-labelledby="ai-h">
              <header><h2 id="ai-h">Audit integrity</h2><Link className="link meta" href="/audit">Open the log</Link></header>
              <p style={{ margin: 0 }}>{lastVerify ? `Last verified ${fmtDateTime(lastVerify.occurredAt, tz)}: ${(lastVerify.after as { ok?: boolean })?.ok ? "the chain was intact." : "the chain was broken."}` : "The chain has not been verified yet."}</p>
            </section>
          ) : null}
        </div>

        <div className="col">
          <section className="panel" aria-labelledby="nt-h">
            <header><h2 id="nt-h">For you</h2>{notes.length ? <MarkRead ids={notes.map((n) => n.id)} /> : null}</header>
            {notes.length ? (
              <div className="list-rows">
                {notes.map((n) => (
                  <Link key={n.id} href={n.href ?? "#"} className="list-row" style={{ alignItems: "flex-start" }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block" }}>{n.title}</span>
                      <span className="meta">{humanize(n.kind)} · {fmtAgo(n.createdAt, at)}</span>
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="empty">No unread notifications.</div>
            )}
          </section>
          {std + enh || hits || myRequests.length ? (
            <section className="panel" aria-labelledby="wait-h">
              <h2 id="wait-h" style={{ marginBottom: 8 }}>Also waiting</h2>
              <div className="list-rows">
                {std ? <Link className="list-row" href="/queues/underwriting-standard"><span style={{ flex: 1 }}>Standard applications</span><span className="num">{std}</span></Link> : null}
                {enh ? <Link className="list-row" href="/queues/underwriting-enhanced"><span style={{ flex: 1 }}>High-risk applications</span><span className="num">{enh}</span></Link> : null}
                {hits ? <Link className="list-row" href="/merchants?group=onboarding"><span style={{ flex: 1 }}>Watchlist matches to review</span><span className="num">{hits}</span></Link> : null}
                {myRequests.length ? <Link className="list-row" href="/approvals?view=mine"><span style={{ flex: 1 }}>Your requests awaiting a decision</span><span className="num">{myRequests.length}</span></Link> : null}
              </div>
            </section>
          ) : null}
          <section className="panel" aria-labelledby="cr-h">
            <header><h2 id="cr-h">Control reviews due</h2><span className="meta">14 days</span></header>
            {controlsDue.length ? (
              <div className="list-rows">
                {controlsDue.map((c) => (
                  <Link key={c.id} className="list-row" href={`/merchants/${c.merchant.id}/controls`}>
                    <span style={{ flex: 1, minWidth: 0 }} className="truncate">{c.merchant.dbaName ?? c.merchant.legalName}<span className="meta" style={{ display: "block" }}>{CONTROL_LABEL[c.type]}</span></span>
                    <span className="num" style={{ color: c.reviewAt < today ? "var(--negative)" : undefined }}>{fmtDate(c.reviewAt, tz)}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="empty">None due in the next 14 days.</div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
