import Link from "next/link";
import { db } from "@/lib/db";
import { requireStaff, viewerTz } from "@/lib/session";
import { can, ROLE_LABEL } from "@/lib/auth/rbac";
import { auditPage, type AuditFilter } from "@/lib/queries/audit";
import { fmtDateTime, humanize } from "@/lib/format";
import { Forbidden } from "@/components/ui/Forbidden";
import { VerifyIntegrity } from "@/components/audit/VerifyIntegrity";
import { ApiLink } from "@/components/ui/ApiLink";

export const metadata = { title: "Audit log" };

const ENTITY_TYPES = ["Merchant", "Application", "Case", "Alert", "Control", "ApprovalRequest", "Rule", "Policy", "Owner", "WatchlistHit", "Rfi", "Document", "User", "ReasonCode", "AuditLog", "System", "Report"];

/** "Can I prove who did what, and is the log intact?" (DESIGN.md §3) */
export default async function AuditPage({ searchParams }: { searchParams: Promise<AuditFilter & { cursor?: string }> }) {
  const user = await requireStaff();
  if (!can(user.role, "audit.read")) return <Forbidden what="the audit log" />;
  const sp = await searchParams;
  const f: AuditFilter = { entityType: sp.entityType || undefined, entityId: sp.entityId || undefined, actor: sp.actor || undefined, action: sp.action || undefined, from: sp.from || undefined, to: sp.to || undefined };
  const [tz, users, page, total, lastCheck] = await Promise.all([
    viewerTz(),
    db.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    auditPage(f, sp.cursor),
    db.auditLog.count(),
    db.auditLog.findFirst({ where: { action: "AUDIT_VERIFIED" }, orderBy: { id: "desc" } }),
  ]);
  const name = new Map(users.map((u) => [u.id, u.name]));
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
  const last = lastCheck?.after as { ok?: boolean; checked?: number; firstBrokenId?: string } | null;
  return (
    <>
      <div className="title-row">
        <div>
          <h1>Audit log</h1>
          <div className="sub">
            {total.toLocaleString()} entries, append-only and hash-chained.{" "}
            {lastCheck ? `Last verified ${fmtDateTime(lastCheck.occurredAt, tz)}: ${last?.ok ? "intact" : `broken at entry ${last?.firstBrokenId}`}.` : "Not verified yet."}
          </div>
        </div>
        <div className="row-gap">
          <ApiLink className="btn" path={`/audit/export${qs.size ? `?${qs}` : ""}`} download data-testid="audit-export">Export CSV</ApiLink>
          {can(user.role, "audit.verify") ? <VerifyIntegrity /> : null}
        </div>
      </div>
      <form className="row-gap" style={{ marginBottom: 16 }} action="/audit" aria-label="Filter the log">
        <select name="entityType" className="input" style={{ width: 170, height: 32 }} defaultValue={f.entityType ?? ""} aria-label="Entity type">
          <option value="">Any entity</option>
          {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input name="entityId" className="input id" style={{ width: 210, height: 32 }} placeholder="Entity ID" defaultValue={f.entityId} aria-label="Entity ID" />
        <select name="actor" className="input" style={{ width: 170, height: 32 }} defaultValue={f.actor ?? ""} aria-label="Actor">
          <option value="">Anyone</option>
          <option value="system">System</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <input name="action" className="input" style={{ width: 170, height: 32 }} placeholder="Action contains" defaultValue={f.action} aria-label="Action" />
        <label className="sr-only" htmlFor="from">From</label>
        <input id="from" name="from" type="date" className="input" style={{ width: 150, height: 32 }} defaultValue={f.from} />
        <label className="sr-only" htmlFor="to">To</label>
        <input id="to" name="to" type="date" className="input" style={{ width: 150, height: 32 }} defaultValue={f.to} />
        <button className="btn">Filter</button>
        {qs.size ? <Link className="link meta" href="/audit">Clear</Link> : null}
      </form>
      <section className="panel flush">
        {page.items.length ? (
          <div className="table-wrap">
            <table className="data responsive-table">
              <thead>
                <tr><th className="n" style={{ width: 70 }}>#</th><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th style={{ width: "34%" }}>Change</th></tr>
              </thead>
              <tbody>
                {page.items.map((r) => (
                  <tr key={r.id.toString()}>
                    <td className="n id muted">{r.id.toString()}</td>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.occurredAt, tz)}</td>
                    <td>{r.actorId ? name.get(r.actorId) ?? r.actorId : r.actorRole === "MERCHANT" ? "Merchant (portal)" : "System"}{r.actorRole ? <span className="sub">{ROLE_LABEL[r.actorRole]}</span> : null}</td>
                    <td>{humanize(r.action)}</td>
                    <td data-line2>
                      {r.entityType}
                      <span className="sub id truncate" style={{ maxWidth: 180 }} title={r.entityId}>{r.entityId}</span>
                    </td>
                    <td data-line2><Diff before={r.before} after={r.after} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: 20 }}><div className="empty">No entries match these filters.</div></div>
        )}
        <div className="meta" style={{ padding: "12px 20px", display: "flex", justifyContent: "space-between" }}>
          <span>Newest first</span>
          {page.nextCursor ? <Link className="link" href={`/audit?${new URLSearchParams({ ...Object.fromEntries(qs), cursor: page.nextCursor })}`}>Older entries</Link> : null}
        </div>
      </section>
    </>
  );
}

/** Before/after as changed keys only, so a reviewer sees the delta at a glance. */
function Diff({ before, after }: { before: unknown; after: unknown }) {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]));
  if (!keys.length) return <span className="muted">—</span>;
  const show = (v: unknown) => (v === undefined || v === null ? "—" : typeof v === "object" ? JSON.stringify(v).slice(0, 80) : String(v).slice(0, 80));
  return (
    <details>
      <summary style={{ cursor: "pointer" }} className="truncate">
        {keys.slice(0, 3).map((k) => `${k}: ${k in b ? `${show(b[k])} → ` : ""}${show(a[k])}`).join(" · ")}
      </summary>
      <dl className="kv" style={{ fontSize: 12, marginTop: 4 }}>
        {keys.map((k) => (
          <div key={k} style={{ display: "contents" }}>
            <dt className="id">{k}</dt>
            <dd style={{ textAlign: "left" }}><span className="muted">{show(b[k])}</span> → {show(a[k])}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
