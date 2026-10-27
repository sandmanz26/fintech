import { requireStaff, viewerTz } from "@/lib/session";
import { signOut } from "@/auth";
import { Sidebar } from "@/components/shell/Sidebar";
import { TimezoneSync } from "@/components/shell/TimezoneSync";
import { sidebarCounts } from "@/lib/queries/queues";
import { can, ROLE_LABEL } from "@/lib/auth/rbac";
import { simToday } from "@/lib/clock";
import { fmtDate } from "@/lib/format";
import { KeyboardShortcuts } from "@/components/shell/KeyboardShortcuts";
import { ToastProvider } from "@/components/ui/Toast";

export const dynamic = "force-dynamic";

export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaff();
  const [counts, today, tz] = await Promise.all([sidebarCounts(user), simToday(), viewerTz()]);
  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }
  return (
    <ToastProvider>
    <div className="app">
      <a href="#main" className="skip-link">Skip to content</a>
      <TimezoneSync current={tz} />
      <KeyboardShortcuts />
      <Sidebar
        user={{ name: user.name, roleLabel: ROLE_LABEL[user.role] }}
        counts={counts}
        caps={{
          rules: can(user.role, "rules.read"),
          audit: can(user.role, "audit.read"),
          admin: can(user.role, "users.manage") || can(user.role, "policy.write"),
          approvals: can(user.role, "approval.decide") || can(user.role, "approval.decide.termination_compliance") || can(user.role, "control.propose"),
          underwriting: can(user.role, "underwriting.decide.standard") || can(user.role, "case.read"),
        }}
        today={fmtDate(today, "UTC")}
        signOutAction={doSignOut}
      />
      <main className="canvas" id="main">
        {children}
      </main>
    </div>
    </ToastProvider>
  );
}
