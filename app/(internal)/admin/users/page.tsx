import { db } from "@/lib/db";
import { requireStaff, viewerTz } from "@/lib/session";
import { can, ROLE_LABEL } from "@/lib/auth/rbac";
import { fmtDate } from "@/lib/format";
import { Forbidden } from "@/components/ui/Forbidden";
import { Avatar } from "@/components/ui/badges";
import { UserRowControls, NewUserForm } from "@/components/admin/UserControls";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  const me = await requireStaff();
  if (!can(me.role, "users.manage")) return <Forbidden what="user management" />;
  const [users, tz, merchants] = await Promise.all([
    db.user.findMany({ orderBy: { createdAt: "asc" } }),
    viewerTz(),
    db.merchant.findMany({ where: { status: { in: ["ACTIVE", "UNDER_REVIEW", "RESTRICTED"] } }, select: { id: true, dbaName: true, legalName: true }, orderBy: { legalName: "asc" } }),
  ]);
  const mname = new Map(merchants.map((m) => [m.id, m.dbaName ?? m.legalName]));
  return (
    <div className="grid-2-1">
      <section className="panel flush" aria-labelledby="u-h">
        <header><h2 id="u-h">Users</h2><span className="meta">{users.length}</span></header>
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="data responsive-table">
            <thead><tr><th>Person</th><th>Role</th><th>Status</th><th className="n">Since</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <span className="row-gap" style={{ flexWrap: "nowrap" }}><Avatar name={u.name} /><span>{u.name}<span className="sub">{u.email}{u.merchantId ? ` · ${mname.get(u.merchantId) ?? "merchant"}` : ""}</span></span></span>
                  </td>
                  <td><UserRowControls id={u.id} role={u.role} active={u.active} self={u.id === me.id} labels={ROLE_LABEL} field="role" /></td>
                  <td><UserRowControls id={u.id} role={u.role} active={u.active} self={u.id === me.id} labels={ROLE_LABEL} field="active" /></td>
                  <td className="n num">{fmtDate(u.createdAt, tz)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel" aria-labelledby="nu-h">
        <h2 id="nu-h" style={{ marginBottom: 12 }}>Add a user</h2>
        <NewUserForm labels={ROLE_LABEL} merchants={merchants.map((m) => ({ id: m.id, name: m.dbaName ?? m.legalName }))} />
      </section>
    </div>
  );
}
