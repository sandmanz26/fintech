import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/auth/rbac";
import { Mark } from "@/components/shell/Mark";
import { Avatar } from "@/components/ui/badges";
import type { Role } from "@prisma/client";
import { guidedStories, type StoryState } from "@/lib/demo/stories";
import { signInAs } from "@/lib/demo/actions";
import { isMockMode } from "@/lib/mode";

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

const login = signInAs;

const STATE: Record<StoryState, { cls: string; label: string }> = {
  todo: { cls: "outline", label: "To do" },
  waiting: { cls: "warn", label: "Waiting for approval" },
  done: { cls: "", label: "Done" },
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; denied?: string; switch?: string; callbackUrl?: string }> }) {
  const sp = await searchParams;
  const me = await getSessionUser();
  // ?switch=1 keeps the page open for a signed-in user: signing in again replaces the session.
  if (me && me.role !== "MERCHANT" && !sp.switch) redirect("/dashboard");
  const [users, stories] = await Promise.all([
    db.user.findMany({ where: { active: true, role: { not: "MERCHANT" } }, orderBy: { createdAt: "asc" } }),
    guidedStories(),
  ]);
  const byRole = new Map(users.map((u) => [u.role, u]));
  return (
    <main style={{ minHeight: "100svh", display: "grid", placeItems: "center", padding: "40px 16px" }}>
      <div style={{ width: "min(720px, 100%)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
          <Mark size={28} />
          <span style={{ fontSize: 18, fontWeight: 600 }}>Sentinel</span>
          <span className="muted">Kestrel Pay · merchant risk</span>
        </div>
        {sp.error ? <p className="notice neg" style={{ marginBottom: 16 }}>That account could not be signed in.</p> : null}
        {sp.denied ? <p className="notice" style={{ marginBottom: 16 }}>Merchant accounts use the link in their email instead of this screen.</p> : null}
        {me && sp.switch ? <p className="notice info" style={{ marginBottom: 16 }}>Signed in as {me.name}. Pick a story or a persona to switch.</p> : null}

        <h1 style={{ fontSize: 24, lineHeight: "30px", fontWeight: 600, margin: "0 0 6px" }}>Walk through a story</h1>
        <p className="muted" style={{ margin: "0 0 16px" }}>
          Five real situations a payfac risk team handles. Each button signs you in as the right person and opens the screen where the work starts.
          {isMockMode() ? " Demo data: fictional merchants and people; changes last until the server restarts." : ""}
        </p>
        <ol className="panel flush" style={{ listStyle: "none", margin: "0 0 28px", padding: 0 }} data-testid="stories">
          {stories.map((st, i) => {
            const who = st.next ? byRole.get(st.next.role) : null;
            return (
              <li key={st.key} style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: "14px 20px", borderTop: i ? "1px solid var(--rule)" : 0 }} data-testid={`story-${st.key}`}>
                <span className="id" style={{ paddingTop: 2, color: "var(--muted)" }}>{st.key}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 500 }}>{st.title}</span>
                    <span className={`pill ${STATE[st.state].cls}`}>{STATE[st.state].label}</span>
                  </span>
                  <span className="muted" style={{ display: "block", fontSize: 13, marginTop: 2 }}>{st.summary}</span>
                  <span className="meta" style={{ display: "block", marginTop: 6 }}>{st.next ? `Next: ${st.next.label}` : st.doneText}</span>
                </span>
                {st.next && who ? (
                  <form action={login} style={{ flex: "none" }}>
                    <input type="hidden" name="email" value={who.email} />
                    <input type="hidden" name="next" value={st.next.href} />
                    <button type="submit" className={`btn sm${st.state === "todo" && i === stories.findIndex((x) => x.next) ? " primary" : ""}`} data-testid={`start-${st.key}`}>
                      {st.state === "waiting" ? "Approve" : "Start"} as {who.name.split(" ")[0]}
                    </button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ol>

        <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 6px" }}>Or sign in as anyone</h2>
        <p className="muted" style={{ margin: "0 0 12px" }}>
          Each persona sees the screens and actions its role allows; the server enforces the same rules.
        </p>
        <div className="panel flush">
          {users.map((u, i) => (
            <form key={u.id} action={login} style={{ borderTop: i ? "1px solid var(--rule)" : 0 }}>
              <input type="hidden" name="email" value={u.email} />
              {sp.callbackUrl ? <input type="hidden" name="next" value={sp.callbackUrl} /> : null}
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
