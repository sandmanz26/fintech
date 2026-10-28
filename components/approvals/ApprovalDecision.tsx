"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client";
import { useToast } from "@/components/ui/Toast";
import { useRequired, FieldHint, NOTE_MIN, noteMessage } from "@/components/ui/Required";

export function ApprovalDecision({ approvalId, canDecide, isRequester, waitingFor }: { approvalId: string; canDecide: boolean; isRequester: boolean; waitingFor: string }) {
  const router = useRouter();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const req = useRequired("ap-note");
  async function decide(decision: "APPROVE" | "REJECT") {
    if (!req.check(note.trim().length >= NOTE_MIN, noteMessage)) return;
    setBusy(true);
    try {
      await api(`/approvals/${approvalId}/decide`, { body: { decision, note } });
      toast(decision === "APPROVE" ? "Approved and carried out." : "Rejected. The requester has been told.");
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not record the decision.", "err");
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    setBusy(true);
    try {
      await api(`/approvals/${approvalId}/cancel`, { body: {} });
      toast("Request cancelled.");
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not cancel.", "err");
    } finally {
      setBusy(false);
    }
  }
  if (isRequester) {
    return (
      <div className="notice info" style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
        <span>You made this request, so someone else must decide it. Waiting for a {waitingFor}.</span>
        <button className="btn sm" disabled={busy} onClick={cancel} data-testid="cancel-approval">Cancel request</button>
      </div>
    );
  }
  if (!canDecide) return <div className="notice info">This request needs a {waitingFor}.</div>;
  return (
    <div style={{ display: "grid", gap: 10, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
      <div className="field">
        <label htmlFor="ap-note">Your note</label>
        <textarea id="ap-note" className="input" value={note} onChange={(e) => (setNote(e.target.value), req.clear())} placeholder="Why you approve or reject" aria-describedby="ap-note-hint" data-testid="approval-note" />
        <FieldHint id="ap-note-hint" error={req.error} hint="Required: a short reason, recorded in the audit log." />
      </div>
      <div className="row-gap">
        <button className="btn primary" disabled={busy} onClick={() => decide("APPROVE")} data-testid="approve">Approve and carry out</button>
        <button className="btn" disabled={busy} onClick={() => decide("REJECT")} data-testid="reject">Reject</button>
      </div>
    </div>
  );
}
