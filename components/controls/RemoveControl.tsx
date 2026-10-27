"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { api, ApiError } from "@/lib/client";
import { useToast } from "@/components/ui/Toast";

export function RemoveControl({ controlId, label, needsApproval, reasons }: { controlId: string; label: string; needsApproval: boolean; reasons: { code: string; label: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(reasons.find((r) => r.code === "CT-REVIEW-COMPLETE")?.code ?? reasons[0]?.code ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      const r = await api<{ removed: boolean }>(`/controls/${controlId}`, { method: "DELETE", body: { reasonCode: reason, note } });
      toast(r.removed ? `${label} removed.` : "Removal sent for approval.");
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not remove.", "err");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="btn sm">Remove</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog" aria-describedby="rm-desc">
          <div style={{ padding: "18px 20px", borderBottom: "1px solid var(--border)" }}>
            <Dialog.Title style={{ margin: 0, fontSize: 18 }}>Remove {label.toLowerCase()}</Dialog.Title>
            <p id="rm-desc" className="muted" style={{ margin: "6px 0 0" }}>
              {needsApproval
                ? "Removing a reserve or a payout hold needs a second approver. Any reserve balance is paid out once approved."
                : "The control comes off immediately."}
            </p>
          </div>
          <div style={{ padding: 20, display: "grid", gap: 14 }}>
            <div className="field">
              <label htmlFor="rm-reason">Reason</label>
              <select id="rm-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
                {reasons.map((r) => (
                  <option key={r.code} value={r.code}>{r.label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="rm-note">Why</label>
              <textarea id="rm-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <div className="drawer-foot">
            <Dialog.Close className="btn">Cancel</Dialog.Close>
            <button className="btn primary" disabled={busy || note.trim().length < 3} onClick={submit}>
              {needsApproval ? "Request removal" : "Remove now"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
