import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { guidedStories } from "@/lib/demo/stories";
import { STORY_BRIEFS, PERSON, UI, t } from "@/lib/demo/briefings";
import { briefLang } from "@/lib/demo/lang";
import { signInAs } from "@/lib/demo/actions";
import { STORY } from "@/lib/sim/stories";
import { LangToggle } from "./LangToggle";

const KEY_BY_REG: Record<string, keyof typeof STORY_BRIEFS> = {
  [STORY.LUMEN]: "S1",
  [STORY.BRIGHTSIDE]: "S2",
  [STORY.QUICKTOP]: "S3",
  [STORY.GLOW]: "S4",
  [STORY.NIMBUS]: "S5",
};
export const storyKeyFor = (registrationNo: string) => KEY_BY_REG[registrationNo] ?? null;

/**
 * The story behind the screen, for someone opening it cold: what happened, why it matters, the
 * steps with the current one marked, and a one-click hand-over when the next step is someone else's.
 */
export async function StoryBriefing({ registrationNo, viewerRole }: { registrationNo: string; viewerRole: Role }) {
  const key = storyKeyFor(registrationNo);
  if (!key) return null;
  const b = STORY_BRIEFS[key];
  const [lang, stories] = await Promise.all([briefLang(), guidedStories()]);
  const st = stories.find((s) => s.key === key);
  const state = st?.state ?? "todo";
  const nextOther = st?.next && st.next.role !== viewerRole ? st.next : null;
  const nextUser = nextOther ? await db.user.findFirst({ where: { role: nextOther.role, active: true }, orderBy: { createdAt: "asc" }, select: { email: true, name: true } }) : null;
  const stepState = (phase: "todo" | "waiting") => (state === "done" || (state === "waiting" && phase === "todo") ? "done" : phase === state ? "current" : "next");

  return (
    <details open className="panel briefing" data-testid="story-briefing">
      <summary>
        <span className="briefing-tag">{t(UI.briefing, lang)} · {key}</span>
        <strong>{t(b.title, lang)}</strong>
        <span className="briefing-you meta">{t(UI.youAre, lang)}: {PERSON[viewerRole]}</span>
      </summary>
      <div className="briefing-body">
        <div className="briefing-cols">
          <div>
            <h3>{t(UI.whatHappened, lang)}</h3>
            <p>{t(b.situation, lang)}</p>
            <h3>{t(UI.whyMatters, lang)}</h3>
            <p>{t(b.why, lang)}</p>
          </div>
          <div>
            <h3>{t(UI.steps, lang)}</h3>
            <ol className="briefing-steps">
              {b.steps.map((s, i) => {
                const ss = stepState(s.phase);
                const mine = s.who === viewerRole;
                return (
                  <li key={i} className={`bs-${ss}`} aria-current={ss === "current" && mine ? "step" : undefined}>
                    <span className="bs-mark" aria-hidden>{ss === "done" ? "✓" : i + 1}</span>
                    <span>
                      <span className="bs-who">
                        {PERSON[s.who]}
                        {ss === "current" ? <em> · {mine ? t(UI.now, lang) : `${t(UI.waitingFor, lang)} ${PERSON[s.who]}`}</em> : null}
                      </span>
                      {t(s.text, lang)}
                    </span>
                  </li>
                );
              })}
              <li className={state === "done" ? "bs-done" : "bs-next"}>
                <span className="bs-mark" aria-hidden>{state === "done" ? "✓" : "★"}</span>
                <span>
                  <span className="bs-who">{t(UI.outcome, lang)}</span>
                  {t(b.done, lang)}
                </span>
              </li>
            </ol>
            {nextOther && nextUser ? (
              <form action={signInAs} style={{ marginTop: 10 }}>
                <input type="hidden" name="email" value={nextUser.email} />
                <input type="hidden" name="next" value={nextOther.href} />
                <button className="btn sm primary" data-testid="briefing-continue">{t(UI.switchTo, lang)} {nextUser.name.split(" ")[0]}</button>
              </form>
            ) : null}
          </div>
        </div>
        <div className="briefing-foot">
          <span><strong>{t(UI.learn, lang)}: {t(b.concept.term, lang)}.</strong> {t(b.concept.text, lang)}</span>
          <LangToggle lang={lang} />
        </div>
      </div>
    </details>
  );
}
