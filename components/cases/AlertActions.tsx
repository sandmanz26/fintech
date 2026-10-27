"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { api, ApiError } from "@/lib/client";
import { useToast } from "@/components/ui/Toast";

export function AlertRowActions({ alertId, reasons }: { alertId: string; merchantId: string; reasons: { code: string; label: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <div className="row-gap" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
      <button
        className="btn sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await api<{ caseId: string }>(`/alerts/${alertId}/link`, { body: { newCase: true } });
            router.push(`/cases/${r.caseId}`);
          } catch (e) {
            toast(e instanceof ApiError ? e.message : "Could not open a case.", "err");
            setBusy(false);
          }
        }}
      >
        Open case
      </button>
      <DismissAlert alertId={alertId} reasons={reasons} onDone={() => router.refresh()} />
    </div>
  );
}

export function DismissAlert({ alertId, reasons, onDone, label = "Dismiss" }: { alertId: string; reasons: { code: string; label: string }[]; onDone: () => void; label?: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(reasons[0]?.code ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await api(`/alerts/${alertId}/dismiss`, { body: { reasonCode: reason, note } });
      toast("Alert dismissed.");
      setOpen(false);
      onDone();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not dismiss.", "err");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="btn sm ghost">{label}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog" aria-describedby="da-desc">
          <div style={{ padding: "18px 20px", borderBottom: "1px solid var(--border)" }}>
            <Dialog.Title style={{ margin: 0, fontSize: 18 }}>Dismiss alert</Dialog.Title>
            <p id="da-desc" className="muted" style={{ margin: "6px 0 0" }}>The reason counts against the rule&apos;s precision, so the rule owner can tune it.</p>
          </div>
          <div style={{ padding: 20, display: "grid", gap: 14 }}>
            <div className="field">
              <label htmlFor={`dr-${alertId}`}>Reason</label>
              <select id={`dr-${alertId}`} className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
                {reasons.map((r) => (
                  <option key={r.code} value={r.code}>{r.label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`dn-${alertId}`}>Note</label>
              <textarea id={`dn-${alertId}`} className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you checked" />
            </div>
          </div>
          <div className="drawer-foot">
            <Dialog.Close className="btn">Cancel</Dialog.Close>
            <button className="btn primary" disabled={busy || note.trim().length < 3} onClick={submit}>Dismiss alert</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
