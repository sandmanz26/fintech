"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/client";
import { useToast } from "@/components/ui/Toast";
import { useRequired, FieldHint, NOTE_MIN } from "@/components/ui/Required";
import { TimeSeries } from "@/components/charts/TimeSeries";
import { METRICS, METRIC_KEYS, RuleDefinitionSchema, describeCondition, type RuleDefinition, type Condition, type MetricKey } from "@/lib/domain/rules/dsl";

type Leaf = { metric: MetricKey; op: string; kind: "const" | "factor"; value: string; factor: string; ref: MetricKey };
type Model = {
  key: string;
  combinator: "all" | "any";
  leaves: Leaf[];
  severity: string;
  statuses: string[];
  minAgeDays: string;
  dedupeHours: string;
  autoCase: boolean;
  caseType: string;
  priority: string;
  slaHours: string;
  evidence: MetricKey[];
};

const OPS = [">", ">=", "<", "<=", "==", "!="];
const unit = (m: MetricKey) => METRICS[m].unit;
/** Inputs are in people units: dollars for money, percent for ratios. Storage is minor units and fractions. */
const toStored = (m: MetricKey, v: string) => (unit(m) === "money" ? Math.round(Number(v) * 100) : unit(m) === "ratio" ? Number(v) / 100 : Number(v));
const toInput = (m: MetricKey, v: number) => String(unit(m) === "money" ? v / 100 : unit(m) === "ratio" ? +(v * 100).toFixed(4) : v);
const suffix = (m: MetricKey) => (unit(m) === "money" ? "$" : unit(m) === "ratio" ? "%" : "");

function fromDef(def: RuleDefinition): Model | null {
  const root = def.when;
  const list: Condition[] = "all" in root ? root.all : "any" in root ? root.any : [root];
  const leaves: Leaf[] = [];
  for (const c of list) {
    if (!("metric" in c) || !OPS.includes(c.op) || Array.isArray(c.value)) return null;
    const v = c.value;
    if (typeof v === "number") leaves.push({ metric: c.metric, op: c.op, kind: "const", value: toInput(c.metric, v), factor: "1", ref: c.metric });
    else if ("mul" in v && v.mul.length === 2 && typeof v.mul[0] === "number" && typeof v.mul[1] === "object" && "metric" in v.mul[1]) {
      leaves.push({ metric: c.metric, op: c.op, kind: "factor", value: "", factor: String(v.mul[0]), ref: v.mul[1].metric });
    } else if ("metric" in v) leaves.push({ metric: c.metric, op: c.op, kind: "factor", value: "", factor: "1", ref: v.metric });
    else return null;
  }
  return {
    key: def.key,
    combinator: "any" in root ? "any" : "all",
    leaves,
    severity: def.severity,
    statuses: def.filters.merchantStatus,
    minAgeDays: String(def.filters.minAgeDays),
    dedupeHours: String(def.dedupe.windowHours),
    autoCase: def.autoCase.enabled,
    caseType: def.autoCase.caseType,
    priority: def.autoCase.priority ?? def.severity,
    slaHours: def.autoCase.slaHours ? String(def.autoCase.slaHours) : "",
    evidence: def.evidenceMetrics,
  };
}

function toDef(m: Model): unknown {
  const leaves = m.leaves.map((l) => ({
    metric: l.metric,
    op: l.op,
    value: l.kind === "const" ? toStored(l.metric, l.value) : Number(l.factor) === 1 ? { metric: l.ref } : { mul: [Number(l.factor), { metric: l.ref }] },
  }));
  return {
    key: m.key,
    scope: "merchant_daily",
    when: leaves.length === 1 ? leaves[0] : { [m.combinator]: leaves },
    filters: { merchantStatus: m.statuses, minAgeDays: Number(m.minAgeDays) || 0 },
    severity: m.severity,
    dedupe: { windowHours: Number(m.dedupeHours) || 24, keyTemplate: "{ruleKey}:{merchantId}:{date}" },
    autoCase: { enabled: m.autoCase, caseType: m.caseType, ...(m.autoCase ? { priority: m.priority, ...(m.slaHours ? { slaHours: Number(m.slaHours) } : {}) } : {}) },
    evidenceMetrics: m.evidence,
  };
}

type Backtest = {
  days: { date: string; candidate: number; active: number }[];
  merchants: { merchantId: string; name: string; candidateDays: number; activeDays: number; firstDate: string }[];
  totals: { candidate: number; active: number; candidateMerchants: number; activeMerchants: number; onlyCandidate: number; onlyActive: number };
  durationMs: number;
};

export function RuleEditor({
  ruleId,
  initial,
  name: initialName,
  description: initialDesc,
  canWrite,
}: {
  ruleId: string | null;
  initial: RuleDefinition | null;
  name: string;
  description: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const blank: Model = { key: "R-", combinator: "all", leaves: [{ metric: "gross_volume_1d", op: ">", kind: "const", value: "5000", factor: "1", ref: "gross_volume_1d" }], severity: "MEDIUM", statuses: ["ACTIVE", "UNDER_REVIEW", "RESTRICTED"], minAgeDays: "14", dedupeHours: "24", autoCase: false, caseType: "MONITORING", priority: "MEDIUM", slaHours: "", evidence: [] };
  const initModel = initial ? fromDef(initial) : blank;
  const [tab, setTab] = useState<"visual" | "json">(initModel ? "visual" : "json");
  const [model, setModel] = useState<Model>(initModel ?? blank);
  const [jsonText, setJsonText] = useState(JSON.stringify(initial ?? toDef(blank), null, 2));
  const [name, setName] = useState(initialName);
  const [desc, setDesc] = useState(initialDesc);
  const [note, setNote] = useState("");
  const [activate, setActivate] = useState(true);
  const [bt, setBt] = useState<Backtest | null>(null);
  const [busy, setBusy] = useState<"" | "bt" | "save">("");

  const current = useMemo(() => {
    try {
      const raw = tab === "visual" ? toDef(model) : JSON.parse(jsonText);
      const r = RuleDefinitionSchema.safeParse(raw);
      return r.success ? { ok: true as const, def: r.data } : { ok: false as const, error: r.error.issues.map((i) => `${i.path.join(".") || "rule"}: ${i.message}`).join("; ") };
    } catch (e) {
      return { ok: false as const, error: `JSON: ${(e as Error).message}` };
    }
  }, [tab, model, jsonText]);

  const setLeaf = (i: number, patch: Partial<Leaf>) => setModel((m) => ({ ...m, leaves: m.leaves.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  function switchTab(t: "visual" | "json") {
    if (t === tab) return;
    if (t === "json") setJsonText(JSON.stringify(current.ok ? current.def : toDef(model), null, 2));
    else {
      try {
        const m = fromDef(RuleDefinitionSchema.parse(JSON.parse(jsonText)));
        if (!m) {
          toast("This rule uses nested logic or expressions the form cannot show. Keep editing it as JSON.", "err");
          return;
        }
        setModel(m);
      } catch {
        toast("Fix the JSON first.", "err");
        return;
      }
    }
    setTab(t);
  }

  async function runBacktest() {
    if (!current.ok) return;
    setBusy("bt");
    try {
      setBt(await api<Backtest>(`/rules/${ruleId ?? "new"}/backtest`, { body: { definition: current.def, days: 90 } }));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Backtest failed.", "err");
    } finally {
      setBusy("");
    }
  }

  const reqNote = useRequired("r-note");
  async function save() {
    if (!current.ok) {
      toast("Fix the definition first: the problems are listed under it.", "err");
      return;
    }
    if (!reqNote.check(note.trim().length >= NOTE_MIN, "Write what changed and why. Every rule version keeps its change note.")) return;
    if (!current.ok) return;
    setBusy("save");
    try {
      if (ruleId) {
        await api(`/rules/${ruleId}/versions`, { body: { name, description: desc, definition: current.def, changeNote: note, activate } });
        toast(activate ? "New version saved and active." : "New version saved.");
        setNote("");
        router.refresh();
      } else {
        const r = await api<{ rule: { id: string } }>(`/rules`, { body: { name, description: desc, definition: current.def, changeNote: note, activate } });
        toast("Rule created.");
        router.push(`/rules/${r.rule.id}`);
      }
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not save.", "err");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="grid-2-1" style={{ gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)" }}>
      <section className="panel" aria-labelledby="ed-h">
        <header>
          <h2 id="ed-h">Definition</h2>
          <div className="segmented" role="group" aria-label="Editor view">
            <button type="button" aria-pressed={tab === "visual"} onClick={() => switchTab("visual")}>Form</button>
            <button type="button" aria-pressed={tab === "json"} onClick={() => switchTab("json")} data-testid="json-tab">View JSON</button>
          </div>
        </header>
        {!canWrite ? (
          <div className="notice info" style={{ marginBottom: 12 }} data-testid="rule-readonly">
            Read-only for your role: only the head of risk changes rules. You can read the definition and run a backtest.
          </div>
        ) : null}
        <fieldset disabled={!canWrite} className={canWrite ? undefined : "readonly"} style={{ border: 0, margin: 0, padding: 0, display: "grid", gap: 14 }}>
          <div className="grid-1-1">
            <div className="field">
              <label htmlFor="r-name">Name</label>
              <input id="r-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="r-key">Key</label>
              <input id="r-key" className="input id" value={model.key} disabled={!!ruleId || tab === "json"} onChange={(e) => setModel({ ...model, key: e.target.value.toUpperCase() })} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="r-desc">What it catches</label>
            <input id="r-desc" className="input" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
          {tab === "visual" ? (
            <>
              <div>
                <div className="row-gap" style={{ marginBottom: 6 }}>
                  <span className="label">Fires when</span>
                  <select className="input" style={{ width: "auto", height: 30 }} value={model.combinator} onChange={(e) => setModel({ ...model, combinator: e.target.value as "all" | "any" })} aria-label="Combine conditions">
                    <option value="all">all of these are true</option>
                    <option value="any">any of these is true</option>
                  </select>
                </div>
                {model.leaves.map((l, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0,1.5fr) 68px minmax(0,1.7fr) 32px", gap: 6, alignItems: "center", padding: "6px 0", borderTop: "1px solid var(--rule)" }}>
                    <select aria-label="Metric" className="input" style={{ height: 32 }} value={l.metric} onChange={(e) => setLeaf(i, { metric: e.target.value as MetricKey })}>
                      {METRIC_KEYS.map((k) => (
                        <option key={k} value={k}>{METRICS[k].label}</option>
                      ))}
                    </select>
                    <select aria-label="Operator" className="input id" style={{ height: 32 }} value={l.op} onChange={(e) => setLeaf(i, { op: e.target.value })}>
                      {OPS.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                    {l.kind === "const" ? (
                      <div className="row-gap" style={{ flexWrap: "nowrap", gap: 4 }}>
                        <input aria-label="Value" className="input num" style={{ height: 32, textAlign: "right" }} value={l.value} onChange={(e) => setLeaf(i, { value: e.target.value })} />
                        <span className="muted" style={{ width: 12 }}>{suffix(l.metric)}</span>
                        <button className="link meta" style={{ whiteSpace: "nowrap" }} type="button" onClick={() => setLeaf(i, { kind: "factor", factor: "2", ref: l.metric })} title="Compare with a multiple of another metric">vs metric</button>
                      </div>
                    ) : (
                      <div className="row-gap" style={{ flexWrap: "nowrap", gap: 4 }}>
                        <input aria-label="Factor" className="input num" style={{ height: 32, width: 56, textAlign: "right" }} value={l.factor} onChange={(e) => setLeaf(i, { factor: e.target.value })} />
                        <span className="muted">×</span>
                        <select aria-label="Compared metric" className="input" style={{ height: 32 }} value={l.ref} onChange={(e) => setLeaf(i, { ref: e.target.value as MetricKey })}>
                          {METRIC_KEYS.map((k) => (
                            <option key={k} value={k}>{METRICS[k].label}</option>
                          ))}
                        </select>
                        <button className="link meta" style={{ whiteSpace: "nowrap" }} type="button" onClick={() => setLeaf(i, { kind: "const", value: "0" })} title="Compare with a fixed value">vs value</button>
                      </div>
                    )}
                    <button type="button" className="btn ghost sm" aria-label="Remove condition" title="Remove condition" disabled={model.leaves.length === 1} onClick={() => setModel({ ...model, leaves: model.leaves.filter((_, j) => j !== i) })}><Trash2 /></button>
                  </div>
                ))}
                <button type="button" className="btn sm" style={{ marginTop: 6 }} onClick={() => setModel({ ...model, leaves: [...model.leaves, { metric: "cb_ratio_30d", op: ">=", kind: "const", value: "1", factor: "1", ref: "cb_ratio_30d" }] })}>Add condition</button>
              </div>
              <div className="grid-3">
                <div className="field">
                  <label htmlFor="r-sev">Severity</label>
                  <select id="r-sev" className="input" value={model.severity} onChange={(e) => setModel({ ...model, severity: e.target.value })}>
                    {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((s) => (
                      <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="r-age">Skip merchants younger than</label>
                  <div className="row-gap" style={{ flexWrap: "nowrap" }}><input id="r-age" className="input num" value={model.minAgeDays} onChange={(e) => setModel({ ...model, minAgeDays: e.target.value })} /><span className="muted">days</span></div>
                </div>
                <div className="field">
                  <label htmlFor="r-dd">One alert per</label>
                  <div className="row-gap" style={{ flexWrap: "nowrap" }}><input id="r-dd" className="input num" value={model.dedupeHours} onChange={(e) => setModel({ ...model, dedupeHours: e.target.value })} /><span className="muted">hours</span></div>
                </div>
              </div>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={model.autoCase} onChange={(e) => setModel({ ...model, autoCase: e.target.checked })} />
                Open a case automatically
              </label>
              {model.autoCase ? (
                <div className="grid-3">
                  <div className="field">
                    <label htmlFor="r-ct">Case type</label>
                    <select id="r-ct" className="input" value={model.caseType} onChange={(e) => setModel({ ...model, caseType: e.target.value })}>
                      {["MONITORING", "DISPUTE_SPIKE", "WATCHLIST"].map((s) => (
                        <option key={s} value={s}>{s === "DISPUTE_SPIKE" ? "Disputes" : s[0] + s.slice(1).toLowerCase()}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="r-pr">Priority</label>
                    <select id="r-pr" className="input" value={model.priority} onChange={(e) => setModel({ ...model, priority: e.target.value })}>
                      {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((s) => (
                        <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="r-sla">SLA (optional)</label>
                    <div className="row-gap" style={{ flexWrap: "nowrap" }}><input id="r-sla" className="input num" value={model.slaHours} placeholder="policy" onChange={(e) => setModel({ ...model, slaHours: e.target.value })} /><span className="muted">hours</span></div>
                  </div>
                </div>
              ) : (
                <div className="meta">Alerts go to “Alerts to triage” unless the merchant already has an open case of this type.</div>
              )}
            </>
          ) : (
            <div className="field">
              <label htmlFor="r-json">Definition (JSON). Money in minor units, ratios as fractions.</label>
              <textarea id="r-json" className="input id" style={{ minHeight: 380, fontSize: 12, lineHeight: "18px" }} spellCheck={false} value={jsonText} onChange={(e) => setJsonText(e.target.value)} data-testid="rule-json" />
            </div>
          )}
        </fieldset>
        <div style={{ marginTop: 14 }} aria-live="polite">
          {current.ok ? (
            <div className="notice info"><strong>Reads as:</strong> {describeCondition(current.def.when)}</div>
          ) : (
            <div className="notice neg" data-testid="rule-error">{current.error}</div>
          )}
        </div>
      </section>

      <div className="col">
        <section className="panel" aria-labelledby="bt-h">
          <header>
            <div>
              <h2 id="bt-h">Backtest</h2>
              <div className="meta">Last 90 days of stored metrics. Creates no alerts.</div>
            </div>
            <button className="btn" disabled={!current.ok || busy === "bt"} onClick={runBacktest} data-testid="run-backtest">{busy === "bt" ? "Running…" : "Run backtest"}</button>
          </header>
          {bt ? (
            <div data-testid="backtest-result">
              <div className="kpis" style={{ marginBottom: 12 }}>
                <div className="kpi">
                  <div className="kpi-label">This version</div>
                  <div className="kpi-value num" style={{ fontSize: 20 }}>{bt.totals.candidate}</div>
                  <div className="kpi-sub">alert-days · {bt.totals.candidateMerchants} merchants</div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">Active version</div>
                  <div className="kpi-value num" style={{ fontSize: 20 }}>{ruleId ? bt.totals.active : "—"}</div>
                  <div className="kpi-sub">{ruleId ? `${bt.totals.activeMerchants} merchants` : "new rule"}</div>
                </div>
              </div>
              <TimeSeries label="Alerts per day, this version against the active one" fmt="count" kind="bar" height={150} data={bt.days.map((d) => ({ date: d.date, value: d.candidate, compare: ruleId ? d.active : undefined }))} compareLabel={ruleId ? "Active version" : undefined} />
              {ruleId ? (
                <p className="meta" style={{ margin: "6px 0 10px" }}>
                  {bt.totals.onlyCandidate} merchants would be newly caught; {bt.totals.onlyActive} would no longer be. Ran in {(bt.durationMs / 1000).toFixed(1)} s.
                </p>
              ) : (
                <p className="meta">Ran in {(bt.durationMs / 1000).toFixed(1)} s.</p>
              )}
              {bt.merchants.length ? (
                <table className="data">
                  <thead>
                    <tr>
                      <th>Merchant</th>
                      <th className="n">Days, this</th>
                      {ruleId ? <th className="n">Days, active</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {bt.merchants.slice(0, 12).map((m) => (
                      <tr key={m.merchantId}>
                        <td><Link className="link" href={`/merchants/${m.merchantId}`}>{m.name}</Link></td>
                        <td className="n num">{m.candidateDays}</td>
                        {ruleId ? <td className="n num" style={{ color: m.candidateDays && !m.activeDays ? "var(--text)" : "var(--muted)" }}>{m.activeDays}</td> : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="empty">No merchant would have triggered this rule.</div>
              )}
            </div>
          ) : (
            <div className="empty">Run a backtest to see how many alerts this version would have raised, and for whom.</div>
          )}
        </section>
        {canWrite ? (
          <section className="panel" aria-labelledby="sv-h">
            <h2 id="sv-h" style={{ marginBottom: 10 }}>Save as a new version</h2>
            <div className="field">
              <label htmlFor="r-note">Change note (required)</label>
              <textarea id="r-note" className="input" value={note} onChange={(e) => (setNote(e.target.value), reqNote.clear())} placeholder="What changed and why" data-testid="change-note" />
              <FieldHint error={reqNote.error} />
            </div>
            <label style={{ display: "flex", gap: 8, margin: "10px 0" }}>
              <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} />
              Make it the active version
            </label>
            <button className="btn primary" disabled={busy === "save"} onClick={save} data-testid="save-rule">
              {busy === "save" ? "Saving…" : ruleId ? "Save version" : "Create rule"}
            </button>
          </section>
        ) : null}
      </div>
    </div>
  );
}
