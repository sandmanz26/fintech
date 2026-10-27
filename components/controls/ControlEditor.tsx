"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { api, ApiError, toMinor, fromMinor } from "@/lib/client";
import { TimeSeries } from "@/components/charts/TimeSeries";
import { useToast } from "@/components/ui/Toast";

type Reason = { code: string; label: string; merchantFacingText: string };
type Sim = { days: { date: string; balance: string; payout: string; baselinePayout: string }[]; weeks: { weekStart: string; withheld: string }[]; endBalance: string; notReceived: string; totalHeld: string };
type Preview = {
  currency: string;
  before: Sim;
  after: Sim;
  coverageNow: number;
  coverageBefore90: number;
  coverageAfter90: number;
  needsApproval: { required: boolean; reason: string | null };
  merchantText: string;
  summary: string;
  exposure: { totalExposure: string; adv: string };
};

export type ControlDraft = { type: string; params: Record<string, unknown>; reasonCode: string; note: string; reviewAt: string };

const TYPES: { type: string; label: string; help: string }[] = [
  { type: "ROLLING_RESERVE", label: "Rolling reserve", help: "Hold a share of each day's sales, release it after a set number of days" },
  { type: "FIXED_RESERVE", label: "Fixed reserve", help: "Hold a share of sales until a target amount is set aside" },
  { type: "UPFRONT_RESERVE", label: "Upfront reserve", help: "Set aside one amount from the first payouts" },
  { type: "PAYOUT_DELAY", label: "Payout delay", help: "Pay out T+n instead of T+1" },
  { type: "PAYOUT_HOLD", label: "Payout hold", help: "Stop all payouts until lifted" },
  { type: "VOLUME_LIMIT_DAILY", label: "Daily volume limit", help: "Flag and alert on volume above a daily amount" },
  { type: "VOLUME_LIMIT_MONTHLY", label: "Monthly volume limit", help: "Flag and alert on volume above a monthly amount" },
  { type: "MAX_TICKET", label: "Maximum transaction", help: "Flag any single payment above an amount" },
];

const money = (minor: string | number | bigint, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(Number(BigInt(minor)) / 100);

function addDaysIso(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function ControlEditor({
  merchantId,
  merchantName,
  today,
  reasons,
  caseId,
  initialType,
  open,
  onOpenChange,
  mode = "save",
  onDraft,
  effectiveFrom,
  allowedTypes,
}: {
  merchantId: string;
  merchantName: string;
  today: string;
  reasons: Reason[];
  caseId?: string;
  initialType?: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode?: "save" | "draft";
  onDraft?: (d: ControlDraft, summary: string, needsApproval: boolean) => void;
  effectiveFrom?: string;
  allowedTypes?: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [type, setType] = useState(initialType ?? "ROLLING_RESERVE");
  const [f, setF] = useState<Record<string, string>>({ pct: "10", holdDays: "120", cap: "", target: "50000", pctUntil: "25", amount: "10000", days: "7", until: "", limit: "", max: "" });
  const [reasonCode, setReasonCode] = useState(reasons[0]?.code ?? "");
  const [note, setNote] = useState("");
  const [reviewAt, setReviewAt] = useState(addDaysIso(today, 30));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const seq = useRef(0);

  useEffect(() => {
    if (initialType) setType(initialType);
  }, [initialType]);

  const params = useMemo<{ ok: true; params: Record<string, unknown> } | { ok: false; field: string; msg: string }>(() => {
    const bps = (s: string) => Math.round(Number(s) * 100);
    const need = (k: string, label: string) => (f[k] && Number(f[k]) > 0 ? null : { ok: false as const, field: k, msg: `Enter ${label}` });
    switch (type) {
      case "ROLLING_RESERVE": {
        const e = need("pct", "a percentage") ?? need("holdDays", "the hold period");
        if (e) return e;
        if (Number(f.pct) > 100) return { ok: false, field: "pct", msg: "100% at most" };
        const cap = f.cap ? toMinor(f.cap) : undefined;
        if (f.cap && !cap) return { ok: false, field: "cap", msg: "Enter an amount" };
        return { ok: true, params: { pctBps: bps(f.pct), holdDays: Math.round(Number(f.holdDays)), ...(cap ? { capMinor: cap } : {}) } };
      }
      case "FIXED_RESERVE": {
        const t = toMinor(f.target);
        if (!t || t === "0") return { ok: false, field: "target", msg: "Enter a target amount" };
        const e = need("pctUntil", "a percentage");
        if (e) return e;
        return { ok: true, params: { targetMinor: t, pctUntilTargetBps: bps(f.pctUntil) } };
      }
      case "UPFRONT_RESERVE": {
        const a = toMinor(f.amount);
        if (!a || a === "0") return { ok: false, field: "amount", msg: "Enter an amount" };
        return { ok: true, params: { amountMinor: a } };
      }
      case "PAYOUT_DELAY": {
        const d = Math.round(Number(f.days));
        if (!(d >= 2 && d <= 60)) return { ok: false, field: "days", msg: "Between 2 and 60 days" };
        return { ok: true, params: { days: d } };
      }
      case "PAYOUT_HOLD":
        return { ok: true, params: f.until ? { untilDate: f.until } : {} };
      case "VOLUME_LIMIT_DAILY":
      case "VOLUME_LIMIT_MONTHLY": {
        const l = toMinor(f.limit);
        if (!l || l === "0") return { ok: false, field: "limit", msg: "Enter a limit" };
        return { ok: true, params: { limitMinor: l } };
      }
      case "MAX_TICKET": {
        const l = toMinor(f.max);
        if (!l || l === "0") return { ok: false, field: "max", msg: "Enter an amount" };
        return { ok: true, params: { maxMinor: l } };
      }
    }
    return { ok: false, field: "type", msg: "Choose a type" };
  }, [type, f]);

  // Live preview: re-simulated whenever a parameter changes (debounced).
  useEffect(() => {
    if (!open || !params.ok) {
      setPreview(null);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const p = await api<Preview>("/controls/preview", { body: { merchantId, type, params: params.params, reasonCode, reviewAt, effectiveFrom } });
        if (mine === seq.current) {
          setPreview(p);
          setPreviewErr(null);
        }
      } catch (e) {
        if (mine === seq.current) setPreviewErr(e instanceof Error ? e.message : "Preview failed");
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [open, merchantId, type, params, reasonCode, reviewAt, effectiveFrom]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const fieldErr = (k: string) => errors[k] ?? (!params.ok && params.field === k && f[k] !== "" ? params.msg : null);

  async function submit() {
    const errs: Record<string, string> = {};
    if (!params.ok) errs[params.field] = params.msg;
    if (!reasonCode) errs.reason = "Choose a reason";
    if (note.trim().length < 3) errs.note = "Explain why in a sentence";
    if (!reviewAt || reviewAt <= today) errs.reviewAt = "Pick a date after today";
    setErrors(errs);
    if (Object.keys(errs).length || !params.ok) return;
    const draft: ControlDraft = { type, params: params.params, reasonCode, note, reviewAt };
    if (mode === "draft") {
      onDraft?.(draft, preview?.summary ?? type, !!preview?.needsApproval.required);
      onOpenChange(false);
      return;
    }
    setSaving(true);
    try {
      const r = await api<{ control: { status: string } }>("/controls", { body: { ...draft, merchantId, caseId, effectiveFrom } });
      toast(r.control.status === "PENDING_APPROVAL" ? "Sent for approval. Nothing changes for the merchant until it is approved." : "Control applied.");
      onOpenChange(false);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not save the control.", "err");
    } finally {
      setSaving(false);
    }
  }

  const types = allowedTypes ? TYPES.filter((t) => allowedTypes.includes(t.type)) : TYPES;
  const reason = reasons.find((r) => r.code === reasonCode);
  const cur = preview?.currency ?? "USD";
  const isReserve = ["ROLLING_RESERVE", "FIXED_RESERVE", "UPFRONT_RESERVE"].includes(type);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="drawer" aria-describedby={undefined} data-testid="control-editor">
          <div className="drawer-head">
            <div>
              <Dialog.Title style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{mode === "draft" ? "Add a condition" : "Add a control"}</Dialog.Title>
              <div className="meta">{merchantName}</div>
            </div>
            <Dialog.Close className="btn ghost sm" aria-label="Close">
              <X />
            </Dialog.Close>
          </div>
          <div className="drawer-body" style={{ display: "grid", gridTemplateColumns: "minmax(0, 340px) minmax(0, 1fr)", gap: 24 }}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
              style={{ display: "grid", gap: 16, alignContent: "start" }}
            >
              <fieldset style={{ border: 0, margin: 0, padding: 0, display: "grid", gap: 6 }}>
                <legend className="label" style={{ marginBottom: 6 }}>Type</legend>
                <select className="input" value={type} onChange={(e) => setType(e.target.value)} aria-describedby="type-help">
                  {types.map((t) => (
                    <option key={t.type} value={t.type}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <div id="type-help" className="hint muted" style={{ fontSize: 12 }}>
                  {TYPES.find((t) => t.type === type)?.help}
                </div>
              </fieldset>

              {type === "ROLLING_RESERVE" ? (
                <>
                  <Num id="pct" label="Share of daily sales held" suffix="%" value={f.pct} onChange={set("pct")} err={fieldErr("pct")} />
                  <Num id="holdDays" label="Released after" suffix="days" value={f.holdDays} onChange={set("holdDays")} err={fieldErr("holdDays")} />
                  <Num id="cap" label="Cap (optional)" prefix="$" value={f.cap} onChange={set("cap")} err={fieldErr("cap")} hint="Stop holding once the reserve reaches this amount" />
                </>
              ) : null}
              {type === "FIXED_RESERVE" ? (
                <>
                  <Num id="target" label="Target reserve" prefix="$" value={f.target} onChange={set("target")} err={fieldErr("target")} />
                  <Num id="pctUntil" label="Share of daily sales held until reached" suffix="%" value={f.pctUntil} onChange={set("pctUntil")} err={fieldErr("pctUntil")} />
                </>
              ) : null}
              {type === "UPFRONT_RESERVE" ? <Num id="amount" label="Amount" prefix="$" value={f.amount} onChange={set("amount")} err={fieldErr("amount")} /> : null}
              {type === "PAYOUT_DELAY" ? <Num id="days" label="Pay out after" suffix="days" value={f.days} onChange={set("days")} err={fieldErr("days")} /> : null}
              {type === "PAYOUT_HOLD" ? (
                <div className="field">
                  <label htmlFor="until">Hold until (optional)</label>
                  <input id="until" type="date" className="input" min={addDaysIso(today, 1)} value={f.until} onChange={set("until")} />
                  <div className="hint">Leave empty to hold until someone lifts it</div>
                </div>
              ) : null}
              {type === "VOLUME_LIMIT_DAILY" || type === "VOLUME_LIMIT_MONTHLY" ? (
                <Num id="limit" label={type === "VOLUME_LIMIT_DAILY" ? "Daily limit" : "Monthly limit"} prefix="$" value={f.limit} onChange={set("limit")} err={fieldErr("limit")} />
              ) : null}
              {type === "MAX_TICKET" ? <Num id="max" label="Largest single payment" prefix="$" value={f.max} onChange={set("max")} err={fieldErr("max")} /> : null}

              <div className="field">
                <label htmlFor="reason">Reason</label>
                <select id="reason" className="input" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} aria-invalid={!!errors.reason}>
                  {reasons.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.label}
                    </option>
                  ))}
                </select>
                {errors.reason ? <div className="err">{errors.reason}</div> : null}
              </div>
              <div className="field">
                <label htmlFor="note">Why, for the file</label>
                <textarea id="note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you saw and why this control fits it" aria-invalid={!!errors.note} />
                {errors.note ? <div className="err">{errors.note}</div> : <div className="hint">Internal. The merchant never sees this note.</div>}
              </div>
              <div className="field">
                <label htmlFor="reviewAt">Review by</label>
                <input id="reviewAt" type="date" className="input" min={addDaysIso(today, 1)} value={reviewAt} onChange={(e) => setReviewAt(e.target.value)} aria-invalid={!!errors.reviewAt} />
                {errors.reviewAt ? <div className="err">{errors.reviewAt}</div> : <div className="hint">A review case opens on this date</div>}
              </div>
              <button type="submit" hidden />
            </form>

            <section aria-labelledby="impact-h" aria-busy={loading} style={{ minWidth: 0, display: "grid", gap: 16, alignContent: "start" }}>
              <div>
                <h3 id="impact-h" style={{ margin: 0, fontSize: 16 }}>Impact over the next 90 days</h3>
                <div className="meta">Simulated on the merchant&apos;s last 30 days of settled volume, with controls already in force</div>
              </div>
              {previewErr ? <div className="notice neg">Couldn&apos;t calculate the impact: {previewErr}</div> : null}
              {!params.ok ? <div className="empty">Fill in the parameters to see the impact.</div> : null}
              {params.ok && !preview ? <div className="skeleton" style={{ height: 320 }} /> : null}
              {params.ok && preview ? (
                <>
                  {preview.needsApproval.required ? (
                    <div className="notice" data-testid="needs-approval">
                      <strong>Needs a second approver.</strong> {preview.needsApproval.reason}. Saving sends a request to the head of risk; nothing changes for the merchant until it is approved.
                    </div>
                  ) : (
                    <div className="notice info">Takes effect as soon as you save{mode === "draft" ? " the decision" : ""}.</div>
                  )}
                  <div className="kpis">
                    <div className="kpi">
                      <div className="kpi-label">Not paid out in 90 days</div>
                      <div className="kpi-value money" style={{ fontSize: 20 }}>{money(BigInt(preview.after.notReceived) - BigInt(preview.before.notReceived), cur)}</div>
                      <div className="kpi-sub">compared with no new control</div>
                    </div>
                    <div className="kpi">
                      <div className="kpi-label">Reserve on day 90</div>
                      <div className="kpi-value money" style={{ fontSize: 20 }}>{money(preview.after.endBalance, cur)}</div>
                      <div className="kpi-sub">without it {money(preview.before.endBalance, cur)}</div>
                    </div>
                    <div className="kpi">
                      <div className="kpi-label">Exposure covered</div>
                      <div className="kpi-value num" style={{ fontSize: 20 }}>{(preview.coverageAfter90 * 100).toFixed(0)}%</div>
                      <div className="kpi-sub">now {(preview.coverageNow * 100).toFixed(0)}%, without it {(preview.coverageBefore90 * 100).toFixed(0)}%</div>
                    </div>
                  </div>
                  {isReserve ? (
                    <div>
                      <div className="chart-head" style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <h4 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>Projected reserve balance</h4>
                        <span className="meta">dashed: without this control</span>
                      </div>
                      <TimeSeries
                        label="Projected reserve balance per day"
                        fmt="money"
                        height={170}
                        data={preview.after.days.map((d, i) => ({ date: d.date, value: Number(d.balance), compare: Number(preview.before.days[i]?.balance ?? 0) }))}
                        compareLabel="Without this control"
                      />
                    </div>
                  ) : null}
                  <div>
                    <div className="chart-head" style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <h4 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>Money the merchant does not receive, per week</h4>
                    </div>
                    <TimeSeries
                      label="Money withheld from payouts per week"
                      fmt="money"
                      kind="bar"
                      height={140}
                      data={preview.after.weeks.map((w, i) => ({ date: w.weekStart, value: Math.max(0, Number(BigInt(w.withheld) - BigInt(preview.before.weeks[i]?.withheld ?? "0"))) }))}
                    />
                  </div>
                  <div>
                    <h4 style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 500 }}>What the merchant will read</h4>
                    <blockquote data-testid="merchant-text" style={{ margin: 0, padding: "12px 14px", background: "var(--raised)", borderRadius: 6, border: "1px solid var(--border)" }}>
                      {preview.merchantText}
                    </blockquote>
                    <div className="meta" style={{ marginTop: 4 }}>From the reason code “{reason?.label}”. No scores, rule names or notes are shown to merchants.</div>
                  </div>
                </>
              ) : null}
            </section>
          </div>
          <div className="drawer-foot">
            <span className="meta" style={{ marginRight: "auto" }}>{preview?.summary}</span>
            <Dialog.Close className="btn">Cancel</Dialog.Close>
            <button className="btn primary" onClick={submit} disabled={saving} data-testid="control-submit">
              {saving ? "Saving…" : mode === "draft" ? "Add condition" : preview?.needsApproval.required ? "Request approval" : "Apply control"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Num({ id, label, value, onChange, prefix, suffix, err, hint }: { id: string; label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; prefix?: string; suffix?: string; err?: string | null; hint?: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        {prefix ? <span className="muted" style={{ position: "absolute", left: 10 }}>{prefix}</span> : null}
        <input id={id} inputMode="decimal" className="input num" value={value} onChange={onChange} aria-invalid={!!err} style={{ paddingLeft: prefix ? 22 : undefined, paddingRight: suffix ? 52 : undefined, textAlign: "right" }} />
        {suffix ? <span className="muted" style={{ position: "absolute", right: 10 }}>{suffix}</span> : null}
      </div>
      {err ? <div className="err">{err}</div> : hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export { fromMinor };
