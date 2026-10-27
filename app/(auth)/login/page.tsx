import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/auth/rbac";
import { Mark } from "@/components/shell/Mark";
import { Avatar } from "@/components/ui/badges";
import type { Role } from "@prisma/client";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const JOB: Record<Role, string> = {
  ANALYST: "Works the alert and case queues; decides low and medium applications.",
  SENIOR_ANALYST: "Underwrites high-risk merchants and sets reserves below the approval line.",
  RISK_MANAGER: "Approves high-impact actions, owns rules and policy, watches the portfolio.",
  COMPLIANCE: "Handles watchlist matches and compliance terminations.",
  AUDITOR: "Reads decisions and the audit log; verifies its integrity.",
  ADMIN: "Manages users, roles and configuration.",
  MERCHANT: "Merchant owner. Answers document requests through the portal link.",
};

async function login(formData: FormData) {
  "use server";
  try {
    await signIn("credentials", { email: String(formData.get("email")), redirectTo: "/dashboard" });
  } catch (e) {
    if (e instanceof AuthError) redirect("/login?error=1");
    throw e;
  }
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; denied?: string }> }) {
  const sp = await searchParams;
  const me = await getSessionUser();
  if (me && me.role !== "MERCHANT") redirect("/dashboard");
  const users = await db.user.findMany({ where: { active: true, role: { not: "MERCHANT" } }, orderBy: { createdAt: "asc" } });
  return (
    <main style={{ minHeight: "100svh", display: "grid", placeItems: "center", padding: "40px 16px" }}>
      <div style={{ width: "min(720px, 100%)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
          <Mark size={28} />
          <span style={{ fontSize: 18, fontWeight: 600 }}>Sentinel</span>
          <span className="muted">Kestrel Pay · merchant risk</span>
        </div>
        <h1 style={{ fontSize: 24, lineHeight: "30px", fontWeight: 600, margin: "0 0 6px" }}>Sign in as a persona</h1>
        <p className="muted" style={{ margin: "0 0 20px" }}>
          Demo login. Each persona sees the screens and actions its role allows; the server enforces the same rules.
        </p>
        {sp.error ? <p className="notice neg" style={{ marginBottom: 16 }}>That account could not be signed in.</p> : null}
        {sp.denied ? <p className="notice" style={{ marginBottom: 16 }}>Merchant accounts use the link in their email instead of this screen.</p> : null}
        <div className="panel flush">
          {users.map((u, i) => (
            <form key={u.id} action={login} style={{ borderTop: i ? "1px solid var(--rule)" : 0 }}>
              <input type="hidden" name="email" value={u.email} />
              <button
                type="submit"
                className="login-row"
                style={{ all: "unset", boxSizing: "border-box", width: "100%", display: "flex", alignItems: "center", gap: 14, padding: "14px 20px", cursor: "pointer" }}
                data-testid={`login-${u.role}`}
              >
                <Avatar name={u.name} size={32} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 500 }}>
                    {u.name} <span className="muted" style={{ fontWeight: 400 }}>· {ROLE_LABEL[u.role]}</span>
                  </span>
                  <span className="muted" style={{ display: "block", fontSize: 13 }}>{JOB[u.role]}</span>
                </span>
                <span className="btn sm" aria-hidden>Sign in</span>
              </button>
            </form>
          ))}
        </div>
      </div>
    </main>
  );
}
