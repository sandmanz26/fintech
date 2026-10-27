"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { api, ApiError } from "@/lib/client";
import { useToast } from "@/components/ui/Toast";
import { ControlEditor, type ControlDraft } from "@/components/controls/ControlEditor";

type Reason = { code: string; label: string; merchantFacingText: string; category: string };

const DOCS = [
  { key: "bank_statement", label: "Bank statements, last 3 months", docType: "BANK_STATEMENT" },
  { key: "processing_history", label: "Processing statements from your previous provider", docType: "PROCESSING_STATEMENT" },
  { key: "incorporation", label: "Certificate of incorporation", docType: "INCORPORATION" },
  { key: "id_document", label: "Photo ID of each owner with 25% or more", docType: "ID_DOCUMENT" },
  { key: "invoice", label: "Supplier invoices for your recent stock", docType: "INVOICE" },
];

function plusDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The decision panel (PRD §6.1). Each option states what it does. Approve options stay locked,
 * with the missing items named, until every required checklist item is PASS or WAIVED.
 */
export function DecisionPanel({
  applicationId,
  merchantId,
  merchantName,
  band,
  missing,
  canDecide,
  cannotReason,
  canOverride,
  reasons,
  today,
  decided,
}: {
  applicationId: string;
  merchantId: string;
  merchantName: string;
  band: string | null;
  missing: string[];
  canDecide: boolean;
  cannotReason: string | null;
  canOverride: boolean;
  reasons: Reason[];
  today: string;
  decided: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const prohibited = band === "PROHIBITED";
  const [decision, setDecision] = useState<string>(prohibited ? "DECLINED" : "APPROVED_WITH_CONDITIONS");
  const uw = reasons.filter((r) => r.category === "UNDERWRITING");
  const approveCodes = uw.filter((r) => !r.code.startsWith("UW-DECLINE"));
  const declineCodes = uw.filter((r) => r.code.startsWith("UW-DECLINE"));
  const [reasonCode, setReasonCode] = useState("");
  const [note, setNote] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [conditions, setConditions] = useState<{ draft: ControlDraft; summary: string; needsApproval: boolean }[]>([]);
  const [editor, setEditor] = useState(false);
  const [docs, setDocs] = useState<string[]>(["bank_statement"]);
  const [message, setMessage] = useState("To finish reviewing your application we need a few more documents. Please upload them using the link below.");
  const [dueAt, setDueAt] = useState(plusDays(today, 7));
  const [busy, setBusy] = useState(false);

  if (decided) return null;
  const isApprove = decision === "APPROVED" || decision === "APPROVED_WITH_CONDITIONS";
  const locked = isApprove && missing.length > 0;
  const codes = decision === "DECLINED" ? declineCodes : approveCodes;
  const code = codes.find((c) => c.code === reasonCode) ? reasonCode : "";
  const merchantText = (decision === "DECLINED" ? declineCodes : approveCodes).find((c) => c.code === code)?.merchantFacingText;
  const overrideMode = prohibited && isApprove;

  const OPTIONS = [
    { v: "APPROVED", label: "Approve", effect: "Merchant goes live on the effective date." },
    { v: "APPROVED_WITH_CONDITIONS", label: "Approve with conditions", effect: "Goes live with the controls below. Controls over the four-eyes line wait for a second approver, and so does go-live." },
    { v: "REQUEST_INFO", label: "Ask for documents", effect: "Sends the merchant a portal link; the application waits for them." },
    { v: "DECLINED", label: "Decline", effect: "Final. The merchant reads the reason code's text." },
  ];

  async function submit() {
    if (decision !== "REQUEST_INFO" && !code) {
      toast("Choose a reason code.", "err");
      return;
    }
    if (decision === "APPROVED_WITH_CONDITIONS" && conditions.length === 0) {
      toast("Add at least one condition, or approve without conditions.", "err");
      return;
    }
    setBusy(true);
    try {
      const body =
        decision === "REQUEST_INFO"
          ? { decision, note, rfi: { items: DOCS.filter((d) => docs.includes(d.key)).map((d) => ({ key: d.key, label: d.label, docType: d.docType, required: true })), message, dueAt } }
          : { decision, reasonCode: code, note, effectiveFrom, controls: decision === "APPROVED_WITH_CONDITIONS" ? conditions.map((c) => ({ ...c.draft })) : [] };
      const r = await api<{ status: string; rfiToken?: string; approvalId?: string }>(`/applications/${applicationId}/decision`, { body });
      const msg: Record<string, string> = {
        APPROVED: "Approved. The merchant is live.",
        APPROVED_PENDING_CONTROLS: "Approved. Go-live waits for the reserve to be approved by the head of risk.",
        DECLINED: "Declined.",
        PENDING_INFO: "Request sent. The application waits for the merchant.",
        PENDING_APPROVAL: "Override sent to the head of risk for approval.",
      };
      toast(msg[r.status] ?? "Saved.");
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not save the decision.", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="dp-h" data-testid="decision-panel">
      <header>
        <h2 id="dp-h">Decision</h2>
      </header>
      {!canDecide ? (
        <div className="notice" style={{ marginBottom: 12 }}>
          <Lock size={14} style={{ verticalAlign: -2 }} /> {cannotReason}
        </div>
      ) : null}
      <fieldset style={{ border: 0, margin: 0, padding: 0, display: "grid", gap: 6 }} disabled={!canDecide}>
        <legend className="sr-only">Decision</legend>
        {OPTIONS.filter((o) => !prohibited || o.v === "DECLINED" || (canOverride && o.v !== "REQUEST_INFO")).map((o) => (
          <label key={o.v} style={{ display: "flex", gap: 10, padding: "8px 10px", borderRadius: 6, border: `1px solid ${decision === o.v ? "var(--text)" : "var(--border)"}`, cursor: "pointer" }}>
            <input type="radio" name="decision" value={o.v} checked={decision === o.v} onChange={() => setDecision(o.v)} style={{ marginTop: 3 }} />
            <span>
              <span style={{ display: "block", fontWeight: 500 }}>{prohibited && o.v !== "DECLINED" ? `${o.label} (override a hard stop)` : o.label}</span>
              <span className="meta">{prohibited && o.v !== "DECLINED" ? "Goes to the head of risk as a four-eyes override." : o.effect}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {canDecide && locked ? (
        <div className="notice" style={{ marginTop: 12 }} data-testid="decision-locked">
          <Lock size={14} style={{ verticalAlign: -2 }} /> <strong>Locked until the checklist is complete.</strong> Still to do: {missing.join("; ")}.
        </div>
      ) : null}

      {canDecide && !locked ? (
        <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
          {decision === "REQUEST_INFO" ? (
            <>
              <fieldset style={{ border: 0, margin: 0, padding: 0, display: "grid", gap: 6 }}>
                <legend className="label" style={{ marginBottom: 4 }}>Documents to ask for</legend>
                {DOCS.map((d) => (
                  <label key={d.key} style={{ display: "flex", gap: 8 }}>
                    <input type="checkbox" checked={docs.includes(d.key)} onChange={(e) => setDocs((xs) => (e.target.checked ? [...xs, d.key] : xs.filter((x) => x !== d.key)))} />
                    {d.label}
                  </label>
                ))}
              </fieldset>
              <div className="field">
                <label htmlFor="rfi-msg">Message to the merchant</label>
                <textarea id="rfi-msg" className="input" value={message} onChange={(e) => setMessage(e.target.value)} />
                <div className="hint">Plain words. No scores, rule names or internal notes.</div>
              </div>
              <div className="field">
                <label htmlFor="rfi-due">Due by</label>
                <input id="rfi-due" type="date" className="input" min={plusDays(today, 1)} value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
              </div>
            </>
          ) : (
            <>
              <div className="field">
                <label htmlFor="dp-reason">Reason code</label>
                <select id="dp-reason" className="input" value={code} onChange={(e) => setReasonCode(e.target.value)} data-testid="decision-reason">
                  <option value="">Choose…</option>
                  {codes.map((c) => (
                    <option key={c.code} value={c.code}>{c.label}</option>
                  ))}
                </select>
              </div>
              {decision === "APPROVED_WITH_CONDITIONS" ? (
                <div>
                  <div className="label" style={{ marginBottom: 6 }}>Conditions</div>
                  {conditions.length ? (
                    <ul style={{ listStyle: "none", margin: "0 0 8px", padding: 0 }} data-testid="conditions">
                      {conditions.map((c, i) => (
                        <li key={i} className="list-row" style={{ borderTop: i ? "1px solid var(--rule)" : 0 }}>
                          <span style={{ flex: 1 }}>{c.summary}</span>
                          {c.needsApproval ? <span className="pill warn">Needs approval</span> : null}
                          <button className="link meta" onClick={() => setConditions((xs) => xs.filter((_, j) => j !== i))}>Remove</button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="empty" style={{ minHeight: 44, marginBottom: 8 }}>No conditions yet.</div>
                  )}
                  <button className="btn sm" onClick={() => setEditor(true)} data-testid="add-condition">Add condition with impact preview</button>
                </div>
              ) : null}
              {isApprove ? (
                <div className="field">
                  <label htmlFor="dp-eff">Goes live on</label>
                  <input id="dp-eff" type="date" className="input" min={today} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
                </div>
              ) : null}
              {merchantText ? (
                <div>
                  <div className="label" style={{ marginBottom: 4 }}>The merchant will read</div>
                  <blockquote style={{ margin: 0, padding: "10px 12px", background: "var(--raised)", borderRadius: 6, border: "1px solid var(--border)" }}>{merchantText}</blockquote>
                </div>
              ) : null}
            </>
          )}
          <div className="field">
            <label htmlFor="dp-note">Note for the file</label>
            <textarea id="dp-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What decided it" />
          </div>
          <button className={`btn ${decision === "DECLINED" ? "danger" : "primary"}`} onClick={submit} disabled={busy} data-testid="decision-submit">
            {busy ? "Saving…" : overrideMode ? "Request override" : OPTIONS.find((o) => o.v === decision)?.label}
          </button>
        </div>
      ) : null}
      <ControlEditor
        mode="draft"
        merchantId={merchantId}
        merchantName={merchantName}
        today={today}
        effectiveFrom={effectiveFrom}
        reasons={reasons.filter((r) => r.category === "CONTROL")}
        open={editor}
        onOpenChange={setEditor}
        initialType="ROLLING_RESERVE"
        onDraft={(draft, summary, needsApproval) => setConditions((xs) => [...xs, { draft, summary, needsApproval }])}
      />
    </section>
  );
}
