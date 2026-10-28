import Link from "next/link";
import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { guidedStories } from "@/lib/demo/stories";
import { signInAs } from "@/lib/demo/actions";

/**
 * Dashboard panel: where each guided story stands and the next step. A step for this persona
 * links straight to the screen; a step for someone else offers the persona switch.
 */
export async function DemoGuide({ role }: { role: Role }) {
  const [stories, people] = await Promise.all([guidedStories(), db.user.findMany({ where: { active: true }, select: { role: true, name: true, email: true }, orderBy: { createdAt: "asc" } })]);
  if (!stories.length) return null;
  const first = new Map<Role, { name: string; email: string }>();
  for (const p of people) if (!first.has(p.role)) first.set(p.role, { name: p.name.split(" ")[0], email: p.email });
  const done = stories.filter((s) => s.state === "done").length;
  return (
    <section className="panel" aria-labelledby="guide-h" data-testid="demo-guide">
      <header>
        <div>
          <h2 id="guide-h">Demo guide</h2>
          <div className="meta">{done} of {stories.length} stories done</div>
        </div>
        <Link className="link meta" href="/login?switch=1">All stories</Link>
      </header>
      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {stories.map((s) => (
          <li key={s.key} style={{ display: "flex", gap: 10, padding: "8px 0", borderTop: "1px solid var(--rule)", alignItems: "flex-start" }}>
            <span className="id" style={{ color: "var(--muted)", paddingTop: 1 }}>{s.key}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontWeight: 500, color: s.state === "done" ? "var(--muted)" : undefined }}>{s.title}</span>
              <span className="meta" style={{ display: "block" }}>{s.next ? s.next.label : s.doneText}</span>
            </span>
            {s.next ? (
              s.next.role === role ? (
                <Link className="btn sm" href={s.next.href} style={{ flex: "none" }}>Open</Link>
              ) : first.get(s.next.role) ? (
                <form action={signInAs} style={{ flex: "none" }}>
                  <input type="hidden" name="email" value={first.get(s.next.role)!.email} />
                  <input type="hidden" name="next" value={s.next.href} />
                  <button className="btn sm" title="Sign in as the person who does this step and open it" data-testid={`guide-switch-${s.key}`}>
                    Continue as {first.get(s.next.role)!.name}
                  </button>
                </form>
              ) : null
            ) : (
              <span className="pill" style={{ flex: "none" }}>Done</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
