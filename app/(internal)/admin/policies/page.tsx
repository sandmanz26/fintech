import { db } from "@/lib/db";
import { requireStaff, viewerTz } from "@/lib/session";
import { can } from "@/lib/auth/rbac";
import { getActivePolicy } from "@/lib/domain/policy";
import { fmtDate } from "@/lib/format";
import { PolicyEditor } from "@/components/admin/PolicyEditor";

export const metadata = { title: "Policy" };

/** Versioned policy (PRD §6.9): a change is a new version; old assessments keep theirs. */
export default async function PoliciesPage() {
  const user = await requireStaff();
  const [active, versions, users, tz, used] = await Promise.all([
    getActivePolicy(),
    db.policy.findMany({ orderBy: { version: "desc" } }),
    db.user.findMany({ select: { id: true, name: true } }),
    viewerTz(),
    db.riskAssessment.groupBy({ by: ["policyVersion"], _count: true }),
  ]);
  const name = new Map(users.map((u) => [u.id, u.name]));
  const usedBy = new Map(used.map((u) => [u.policyVersion, u._count]));
  return (
    <div className="grid-2-1">
      <PolicyEditor params={active.params} version={active.version} canWrite={can(user.role, "policy.write")} />
      <section className="panel flush" aria-labelledby="pv-h">
        <header><h2 id="pv-h">Versions</h2></header>
        <div className="list-rows" style={{ padding: "8px 20px 12px" }}>
          {versions.map((v) => (
            <div key={v.id} style={{ padding: "10px 0" }}>
              <div className="row-gap" style={{ justifyContent: "space-between" }}>
                <strong style={{ fontWeight: 500 }}>v{v.version}{v.version === active.version ? <span className="pill" style={{ marginLeft: 8 }}>Active</span> : null}</strong>
                <span className="meta">{fmtDate(v.activeFrom, tz)}</span>
              </div>
              <div className="muted" style={{ fontSize: 13 }}>{v.changeNote || "—"}</div>
              <div className="meta">{name.get(v.createdById) ?? "—"} · {usedBy.get(v.version) ?? 0} assessments use it</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
