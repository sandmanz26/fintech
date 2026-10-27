import { requireStaff } from "@/lib/session";
import { can } from "@/lib/auth/rbac";
import { TabNav } from "@/components/ui/TabNav";
import { Forbidden } from "@/components/ui/Forbidden";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaff();
  const users = can(user.role, "users.manage");
  const policy = can(user.role, "policy.write");
  if (!users && !policy) return <Forbidden what="administration" />;
  return (
    <>
      <div className="title-row">
        <div>
          <h1>Admin</h1>
          <div className="sub">Every change here is versioned or audited.</div>
        </div>
      </div>
      <TabNav
        label="Admin sections"
        tabs={[...(users ? [{ href: "/admin/users", label: "Users" }] : []), { href: "/admin/policies", label: "Policy" }, { href: "/admin/reason-codes", label: "Reason codes" }]}
      />
      {children}
    </>
  );
}
