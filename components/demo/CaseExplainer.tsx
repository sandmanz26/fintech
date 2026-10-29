import { CASE_TYPE_EXPLAIN, RULE_EXPLAIN, UI, t } from "@/lib/demo/briefings";
import { briefLang } from "@/lib/demo/lang";
import { LangToggle } from "./LangToggle";

/** "What is this case?": the case type and every rule behind it, in plain language. */
export async function CaseExplainer({ caseType, ruleKeys, ruleNames, open }: { caseType: string; ruleKeys: string[]; ruleNames: Record<string, string>; open: boolean }) {
  const lang = await briefLang();
  const rules = [...new Set(ruleKeys)].filter((k) => RULE_EXPLAIN[k]);
  const type = CASE_TYPE_EXPLAIN[caseType];
  if (!type && !rules.length) return null;
  return (
    <details open={open} className="panel briefing" data-testid="case-explainer">
      <summary>
        <span className="briefing-tag">{t(UI.aboutCase, lang)}</span>
        <span className="muted">{type ? t(type, lang) : ""}</span>
      </summary>
      <div className="briefing-body">
        {rules.length ? (
          <div className="explain-rules">
            {rules.map((k) => {
              const r = RULE_EXPLAIN[k];
              return (
                <div key={k} className="explain-rule">
                  <strong>{ruleNames[k] ?? k}</strong> <span className="id meta">{k}</span>
                  <dl>
                    <dt>{t(UI.ruleWhat, lang)}</dt>
                    <dd>{t(r.what, lang)}</dd>
                    <dt>{t(UI.ruleWhy, lang)}</dt>
                    <dd>{t(r.why, lang)}</dd>
                    <dt>{t(UI.ruleAct, lang)}</dt>
                    <dd>{t(r.act, lang)}</dd>
                  </dl>
                </div>
              );
            })}
          </div>
        ) : null}
        <div className="briefing-foot">
          <span />
          <LangToggle lang={lang} />
        </div>
      </div>
    </details>
  );
}
