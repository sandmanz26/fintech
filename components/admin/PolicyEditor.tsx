"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client";
import { useToast } from "@/components/ui/Toast";
import type { PolicyParams } from "@/lib/domain/policy/types";

type Field = { path: string[]; label: string; unit: string; scale?: number; hint?: string; fraction?: boolean };

/** The parameters people change most, as a form; everything else stays reachable as JSON. */
const FIELDS: { group: string; fields: Field[] }[] = [
  { group: "Risk bands", fields: [
    { path: ["scoring", "bands", "mediumFrom"], label: "Medium from score", unit: "" },
    { path: ["scoring", "bands", "highFrom"], label: "High from score", unit: "" },
  ] },
  { group: "Four-eyes thresholds", fields: [
    { path: ["fourEyes", "rollingReservePctBps"], label: "Rolling reserve at or above", unit: "%", scale: 100 },
    { path: ["fourEyes", "fixedReserveMinor"], label: "Fixed or upfront reserve at or above", unit: "$", scale: 100 },
  ] },
  { group: "SLA by priority", fields: [
    { path: ["sla", "CRITICAL"], label: "Critical", unit: "hours" },
    { path: ["sla", "HIGH"], label: "High", unit: "hours" },
    { path: ["sla", "MEDIUM"], label: "Medium", unit: "hours" },
    { path: ["sla", "LOW_BUSINESS_DAYS"], label: "Low", unit: "business days" },
  ] },
  { group: "Network and disputes", fields: [
    { path: ["network", "visa", "merchantExcessiveBps"], label: "Visa VAMP merchant line", unit: "%", scale: 100, hint: "Verify against current network rules" },
    { path: ["network", "visa", "acquirerAboveStandardBps"], label: "Visa VAMP acquirer line", unit: "%", scale: 100, hint: "The portfolio is assessed against this" },
    { path: ["network", "mastercard", "ecmBps"], label: "Mastercard ECM line", unit: "%", scale: 100 },
    { path: ["network", "mastercard", "ecmMinChargebacks"], label: "Mastercard ECM floor", unit: "chargebacks" },
    { path: ["network", "earlyWarningShare"], label: "Early warning at", unit: "% of each line", scale: 0.01, fraction: true },
    { path: ["network", "warningMinCount"], label: "Warn from", unit: "counts", hint: "Below this a tiny merchant does not page anyone" },
    { path: ["disputeWindowDays"], label: "Dispute window", unit: "days" },
  ] },
];

const get = (o: unknown, p: string[]) => p.reduce<unknown>((a, k) => (a as Record<string, unknown>)?.[k], o);
function set(o: Record<string, unknown>, p: string[], v: unknown) {
  const c = structuredClone(o);
  let x = c as Record<string, unknown>;
  for (const k of p.slice(0, -1)) x = x[k] as Record<string, unknown>;
  x[p.at(-1)!] = v;
  return c;
}

export function PolicyEditor({ params, version, canWrite }: { params: PolicyParams; version: number; canWrite: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, unknown>>(params as unknown as Record<string, unknown>);
  const [json, setJson] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [impact, setImpact] = useState<{ moves: Record<string, number>; checked: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const value = (f: Field) => {
    const v = get(draft, f.path);
    const n = typeof v === "string" ? Number(v) : (v as number);
    return f.scale ? String(Math.round((n / f.scale) * 100) / 100) : String(n);
  };
  const change = (f: Field, s: string) => {
    const n = Number(s);
    if (Number.isNaN(n)) return;
    const stored = f.scale ? (f.fraction ? Math.round(n * f.scale * 10_000) / 10_000 : Math.round(n * f.scale)) : n;
    const cur = get(draft, f.path);
    setDraft(set(draft, f.path, typeof cur === "string" ? String(stored) : stored));
    setImpact(null);
  };
  const payload = () => (json !== null ? JSON.parse(json) : draft);

  async function post(dryRun: boolean) {
    setBusy(true);
    try {
      const r = await api<{ moves: Record<string, number>; checked: number }>("/admin/policies", { body: { params: payload(), changeNote: note || "dry run", dryRun } });
      if (dryRun) setImpact(r);
      else {
        toast("New policy version saved. It applies to the next scoring; past assessments keep their version.");
        setNote("");
        router.refresh();
      }
    } catch (e) {
      toast(e instanceof ApiError ? e.message : e instanceof SyntaxError ? "The JSON is not valid." : "Could not save.", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="pe-h">
      <header>
        <div>
          <h2 id="pe-h">Policy v{version}</h2>
          <div className="meta">Saving creates v{version + 1}</div>
        </div>
        <button className="link meta" onClick={() => setJson(json === null ? JSON.stringify(draft, null, 2) : null)}>{json === null ? "Edit all as JSON" : "Back to the form"}</button>
      </header>
      <fieldset disabled={!canWrite} style={{ border: 0, margin: 0, padding: 0 }}>
        {json === null ? (
          <div style={{ display: "grid", gap: 18 }}>
            {FIELDS.map((g) => (
              <div key={g.group}>
                <h3 style={{ marginBottom: 8 }}>{g.group}</h3>
                <div className="grid-1-1" style={{ gap: 12 }}>
                  {g.fields.map((f) => (
                    <div className="field" key={f.path.join(".")}>
                      <label htmlFor={f.path.join(".")}>{f.label}</label>
                      <div className="row-gap" style={{ flexWrap: "nowrap" }}>
                        {f.unit === "$" ? <span className="muted">$</span> : null}
                        <input id={f.path.join(".")} className="input num" style={{ textAlign: "right" }} value={value(f)} onChange={(e) => change(f, e.target.value)} />
                        {f.unit && f.unit !== "$" ? <span className="muted" style={{ whiteSpace: "nowrap" }}>{f.unit}</span> : null}
                      </div>
                      {f.hint ? <div className="hint">{f.hint}</div> : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <textarea className="input id" aria-label="Policy JSON" style={{ minHeight: 420, fontSize: 12, lineHeight: "18px" }} spellCheck={false} value={json} onChange={(e) => setJson(e.target.value)} />
        )}
        {canWrite ? (
          <div style={{ display: "grid", gap: 10, marginTop: 18, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
            <div className="row-gap">
              <button type="button" className="btn" disabled={busy} onClick={() => post(true)}>Check the impact</button>
              {impact ? (
                <span className="muted" data-testid="policy-impact">
                  {Object.keys(impact.moves).length ? `At current scores: ${Object.entries(impact.moves).map(([k, n]) => `${n} ${k.toLowerCase().replace("→", " → ")}`).join(", ")}` : `No band changes across ${impact.checked} merchants`}
                </span>
              ) : null}
            </div>
            <div className="field">
              <label htmlFor="pol-note">Change note (required)</label>
              <textarea id="pol-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed and why" />
            </div>
            <button type="button" className="btn primary" disabled={busy || note.trim().length < 3} onClick={() => post(false)}>Save as v{version + 1}</button>
          </div>
        ) : null}
      </fieldset>
    </section>
  );
}
