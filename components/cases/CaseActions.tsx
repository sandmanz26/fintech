"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiError } from "@/lib/client";
import { useToast } from "@/components/ui/Toast";
import { useRequired, FieldHint, NOTE_MIN, noteMessage } from "@/components/ui/Required";
import { TerminateDialog } from "@/components/merchant/TerminateDialog";

type Reason = { code: string; label: string; merchantFacingText: string; category: string };

const RFI_ITEMS = [
  { key: "invoice", label: "Supplier invoices or purchase orders for your recent large sales", docType: "INVOICE" },
  { key: "bank_statement", label: "Bank statements for the last 3 months", docType: "BANK_STATEMENT" },
  { key: "processing_history", label: "Statements from your previous card processor", docType: "PROCESSING_STATEMENT" },
  { key: "id_document", label: "Photo ID of each owner with 25% or more", docType: "ID_DOCUMENT" },
  { key: "other", label: "A short letter explaining the recent change in sales", docType: "OTHER" },
];

function plusDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The action panel (PRD §6.4): each action says what it will do before it is clicked. */
export function CaseActions(props: {
  caseId: string;
  merchantId: string;
  merchantName: string;
  status: string;
  assigneeId: string | null;
  me: { id: string };
  users: { id: string; name: string }[];
  canWork: boolean;
  canPropose: boolean;
  processing: boolean;
  reasons: Reason[];
  today: string;
  pendingApproval: { id: string; summary: string; requestedBy: string; at: string } | null;
  openRfi: { items: { label: string; status: string }[]; dueAt: string; status: string } | null;
  controlsSummary: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<null | "rfi" | "close">(null);
  const [term, setTerm] = useState(false);
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const { status } = props;
  const resolved = status === "RESOLVED";
  const reviewing = status === "IN_REVIEW";

  async function call(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Something went wrong.", "err");
    } finally {
      setBusy(false);
    }
  }

  if (!props.canWork) {
    return (
      <aside className="panel">
        <h2>Actions</h2>
        <p className="muted" style={{ marginTop: 8 }}>Your role can read cases but not work them.</p>
      </aside>
    );
  }

  const Action = ({ title, effect, children }: { title: string; effect: string; children: React.ReactNode }) => (
    <div style={{ padding: "12px 0", borderTop: "1px solid var(--rule)" }}>
      <div style={{ fontWeight: 500 }}>{title}</div>
      <div className="meta" style={{ margin: "2px 0 8px" }}>{effect}</div>
      {children}
    </div>
  );

  return (
    <aside className="panel" aria-labelledby="act-h" data-testid="case-actions">
      <h2 id="act-h" style={{ marginBottom: 6 }}>Actions</h2>

      {props.pendingApproval ? (
        <div className="notice" style={{ marginBottom: 8 }}>
          <strong>Waiting for a second approver.</strong> {props.pendingApproval.summary}
          <div className="meta" style={{ color: "inherit" }}>Requested by {props.pendingApproval.requestedBy} on {props.pendingApproval.at}</div>
          <Link className="link" href={`/approvals?id=${props.pendingApproval.id}`}>Open the request</Link>
        </div>
      ) : null}
      {props.openRfi ? (
        <div className="notice info" style={{ marginBottom: 8 }} data-testid="open-rfi">
          <strong>Waiting on the merchant</strong> · due {props.openRfi.dueAt}
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {props.openRfi.items.map((i) => (
              <li key={i.label}>{i.label} <span className="meta">· {i.status === "RECEIVED" ? "received" : "not yet"}</span></li>
            ))}
          </ul>
        </div>
      ) : null}
      {portalUrl ? (
        <div className="notice info" style={{ marginBottom: 8 }}>
          <strong>Portal link for the merchant</strong>
          <div className="id" style={{ fontSize: 12, wordBreak: "break-all", margin: "4px 0" }} data-testid="portal-url">{portalUrl}</div>
          <button className="link" onClick={() => navigator.clipboard?.writeText(portalUrl)}>Copy link</button>
          <span className="meta"> · in production this is emailed; the token expires 7 days after the due date</span>
        </div>
      ) : null}

      {!resolved ? (
        <Action title={props.assigneeId === props.me.id ? "Reassign" : "Assign"} effect={props.assigneeId ? "Moves ownership; the SLA does not reset." : "Takes the case out of Unassigned."}>
          <div className="row-gap">
            {props.assigneeId !== props.me.id ? (
              <button className="btn sm" data-shortcut="assign-page" disabled={busy} onClick={() => call(() => api(`/cases/${props.caseId}/assign`, { body: { assigneeId: props.me.id } }), "Assigned to you.")}>
                Assign to me
              </button>
            ) : null}
            <select
              aria-label="Assign to"
              className="input"
              style={{ height: 28, width: "auto", flex: 1 }}
              value=""
              onChange={(e) => e.target.value && call(() => api(`/cases/${props.caseId}/assign`, { body: { assigneeId: e.target.value } }), "Reassigned.")}
            >
              <option value="">Assign to…</option>
              {props.users.filter((u) => u.id !== props.assigneeId).map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
        </Action>
      ) : null}

      {["NEW", "ASSIGNED", "REOPENED"].includes(status) ? (
        <Action title="Start review" effect={status === "NEW" ? "Assigns it to you and moves it to In review." : "Moves the case to In review."}>
          <button className="btn sm primary" data-testid="start-review" disabled={busy} onClick={() => call(() => api(`/cases/${props.caseId}/transition`, { body: { to: "IN_REVIEW" } }), "Review started.")}>
            Start review
          </button>
        </Action>
      ) : null}

      {reviewing || ["NEW", "ASSIGNED", "REOPENED"].includes(status) ? (
        <Action title="Ask the merchant for documents" effect="Sends a portal link. The case waits on the merchant and returns to review when they answer or the deadline passes.">
          {panel === "rfi" ? (
            <RfiForm caseId={props.caseId} today={props.today} onSent={(url) => { setPanel(null); setPortalUrl(url); router.refresh(); }} onCancel={() => setPanel(null)} />
          ) : (
            <button className="btn sm" data-testid="open-rfi-form" onClick={() => setPanel("rfi")}>Request documents</button>
          )}
        </Action>
      ) : null}

      {props.processing && !resolved && status !== "PENDING_APPROVAL" ? (
        <Action title="Add a control" effect={`Opens the editor with a 90-day cash preview. Reserves of 10% or more and payout holds go to the head of risk.${props.controlsSummary.length ? ` In force: ${props.controlsSummary.join("; ")}.` : ""}`}>
          <Link className="btn sm" data-testid="case-add-control" href={`/merchants/${props.merchantId}?control=new&caseId=${props.caseId}`}>Open control editor</Link>
        </Action>
      ) : null}

      {props.processing && props.canPropose && !resolved && status !== "PENDING_APPROVAL" ? (
        <Action title="Propose termination" effect="Stops processing if a second person approves. The reserve stays held through the dispute window.">
          <button className="btn sm danger" data-testid="case-terminate" onClick={() => setTerm(true)}>Propose termination…</button>
          <TerminateDialog merchantId={props.merchantId} merchantName={props.merchantName} reasons={props.reasons.filter((r) => r.category === "TERMINATION")} open={term} onOpenChange={setTerm} caseId={props.caseId} />
        </Action>
      ) : null}

      {reviewing ? (
        <Action title="Close the case" effect="Needs a resolution code and a note. With no other high case open and no heavy control, the merchant returns to Active.">
          {panel === "close" ? (
            <CloseForm caseId={props.caseId} reasons={props.reasons.filter((r) => r.category === "CASE_RESOLUTION")} onDone={() => { setPanel(null); router.refresh(); }} onCancel={() => setPanel(null)} />
          ) : (
            <button className="btn sm" data-testid="close-case" onClick={() => setPanel("close")}>Close case…</button>
          )}
        </Action>
      ) : null}

      {resolved ? <p className="muted" style={{ marginTop: 6 }}>Resolved. A new related alert within 14 days reopens it automatically.</p> : null}
    </aside>
  );
}

function RfiForm({ caseId, today, onSent, onCancel }: { caseId: string; today: string; onSent: (url: string) => void; onCancel: () => void }) {
  const toast = useToast();
  const [items, setItems] = useState<string[]>(["invoice"]);
  const [message, setMessage] = useState("We noticed a change in your recent sales and want to make sure your account keeps running smoothly. Please send us the documents below.");
  const [due, setDue] = useState(plusDays(today, 5));
  const [busy, setBusy] = useState(false);
  const req = useRequired("rfi-docs");
  async function send() {
    if (!req.check(items.length > 0, "Tick at least one document to request.")) return;
    setBusy(true);
    try {
      const r = await api<{ portalUrl: string }>(`/cases/${caseId}/rfi`, {
        body: { items: RFI_ITEMS.filter((i) => items.includes(i.key)).map((i) => ({ key: i.key, label: i.label, docType: i.docType, required: true })), message, dueAt: due },
      });
      toast("Request sent to the merchant.");
      onSent(r.portalUrl);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not send.", "err");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ display: "grid", gap: 10 }} data-testid="rfi-form">
      <fieldset id="rfi-docs" tabIndex={-1} style={{ border: 0, margin: 0, padding: 0, display: "grid", gap: 6 }}>
        <legend className="label" style={{ marginBottom: 4 }}>Documents</legend>
        {RFI_ITEMS.map((i) => (
          <label key={i.key} style={{ display: "flex", gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={items.includes(i.key)} onChange={(e) => (req.clear(), setItems((xs) => (e.target.checked ? [...xs, i.key] : xs.filter((x) => x !== i.key))))} />
            {i.label}
          </label>
        ))}
        <FieldHint error={req.error} />
      </fieldset>
      <div className="field">
        <label htmlFor="rfi-m">Message</label>
        <textarea id="rfi-m" className="input" value={message} onChange={(e) => setMessage(e.target.value)} />
        <div className="hint">The merchant sees this, the list and the due date. Nothing else.</div>
      </div>
      <div className="field">
        <label htmlFor="rfi-d">Due by</label>
        <input id="rfi-d" type="date" className="input" min={plusDays(today, 1)} value={due} onChange={(e) => setDue(e.target.value)} />
      </div>
      <div className="row-gap">
        <button className="btn sm primary" disabled={busy} onClick={send} data-testid="send-rfi">Send request</button>
        <button className="btn sm ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function CloseForm({ caseId, reasons, onDone, onCancel }: { caseId: string; reasons: { code: string; label: string }[]; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const usable = reasons.filter((r) => !["CR-TERMINATED", "CR-UW-DECIDED", "CR-CONTROL-REMOVED"].includes(r.code));
  const reqCode = useRequired("cl-code");
  const reqNote = useRequired("cl-note");
  async function close() {
    if (!reqCode.check(!!code, "Choose how the case was resolved.")) return;
    if (!reqNote.check(note.trim().length >= NOTE_MIN, noteMessage)) return;
    setBusy(true);
    try {
      await api(`/cases/${caseId}/transition`, { body: { to: "RESOLVED", reasonCode: code, note } });
      toast("Case closed.");
      onDone();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not close.", "err");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className="field">
        <label htmlFor="cl-code">Resolution</label>
        <select id="cl-code" className="input" value={code} onChange={(e) => (setCode(e.target.value), reqCode.clear())} data-testid="resolution-code">
          <option value="">Choose…</option>
          {usable.map((r) => (
            <option key={r.code} value={r.code}>{r.label}</option>
          ))}
        </select>
        <FieldHint error={reqCode.error} />
      </div>
      <div className="field">
        <label htmlFor="cl-note">Note</label>
        <textarea id="cl-note" className="input" value={note} onChange={(e) => (setNote(e.target.value), reqNote.clear())} placeholder="What you found and why this closes it" data-testid="resolution-note" />
        <FieldHint error={reqNote.error} hint="Required, for the audit log." />
      </div>
      <div className="row-gap">
        <button className="btn sm primary" disabled={busy} onClick={close} data-testid="confirm-close">Close case</button>
        <button className="btn sm ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
