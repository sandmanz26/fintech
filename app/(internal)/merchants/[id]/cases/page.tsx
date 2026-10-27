import Link from "next/link";
import { db } from "@/lib/db";
import { viewerTz } from "@/lib/session";
import { now } from "@/lib/clock";
import { fmtDate, humanize } from "@/lib/format";
import { SeverityPill, SlaText } from "@/components/ui/badges";
import { CASE_STATUS_LABEL } from "@/lib/domain/caseStateMachine";

export default async function CasesTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [cases, tz, at, users] = await Promise.all([
    db.case.findMany({ where: { merchantId: id }, orderBy: { createdAt: "desc" }, include: { _count: { select: { alerts: true } } } }),
    viewerTz(),
    now(),
    db.user.findMany({ select: { id: true, name: true } }),
  ]);
  const name = new Map(users.map((u) => [u.id, u.name]));
  return (
    <section className="panel flush" aria-labelledby="mc-h">
      <header>
        <h2 id="mc-h">Cases</h2>
        <span className="meta">{cases.length} in total</span>
      </header>
      {cases.length ? (
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="data responsive-table">
            <thead>
              <tr>
                <th>Case</th>
                <th>Priority</th>
                <th>Status</th>
                <th>SLA</th>
                <th>Owner</th>
                <th className="n">Opened</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link className="link" href={`/cases/${c.id}`}>{c.title ?? humanize(c.type)}</Link>
                    <span className="sub">{humanize(c.type)} · {c._count.alerts} alerts{c.resolutionCode ? ` · ${c.resolutionCode}` : ""}</span>
                  </td>
                  <td><SeverityPill severity={c.priority} /></td>
                  <td>{CASE_STATUS_LABEL[c.status]}</td>
                  <td data-line2><SlaText due={c.slaDueAt} now={at} resolved={c.status === "RESOLVED"} /></td>
                  <td data-hide-phone>{c.assigneeId ? name.get(c.assigneeId) : <span className="muted">Unassigned</span>}</td>
                  <td className="n num">{fmtDate(c.createdAt, tz)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ padding: "0 20px 20px" }}><div className="empty">No cases for this merchant.</div></div>
      )}
    </section>
  );
}
