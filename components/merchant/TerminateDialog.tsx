"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { api, ApiError } from "@/lib/client";
import { useToast } from "@/components/ui/Toast";

const CATEGORIES: { key: string; label: string; code: string }[] = [
  { key: "FRAUD", label: "Fraud", code: "TR-FRAUD" },
  { key: "EXCESSIVE_CHARGEBACKS", label: "Excessive chargebacks", code: "TR-CHARGEBACKS" },
  { key: "PRODUCT_POLICY", label: "Product policy violation", code: "TR-PRODUCT-POLICY" },
  { key: "COMPLIANCE", label: "Compliance or sanctions", code: "TR-COMPLIANCE" },
  { key: "MERCHANT_REQUEST", label: "Merchant request", code: "TR-MERCHANT-REQUEST" },
  { key: "INACTIVE", label: "Inactive", code: "TR-INACTIVE" },
];

/** Propose a termination. States the consequence before the click; it only happens after a second person approves. */
export function TerminateDialog({ merchantId, merchantName, reasons, open, onOpenChange, caseId }: { merchantId: string; merchantName: string; reasons: { code: string; label: string; merchantFacingText: string }[]; open: boolean; onOpenChange: (o: boolean) => void; caseId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [cat, setCat] = useState("EXCESSIVE_CHARGEBACKS");
  const [note, setNote] = useState("");
  const [list, setList] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const code = CATEGORIES.find((c) => c.key === cat)!.code;
  const text = reasons.find((r) => r.code === code)?.merchantFacingText;
  const ok = note.trim().length >= 3 && confirm.trim().toLowerCase() === merchantName.toLowerCase();

  async function submit() {
    setBusy(true);
    try {
      await api(`/merchants/${merchantId}/terminate`, { body: { reasonCategory: cat, reasonCode: code, note, addToTerminatedList: list, caseId } });
      toast("Termination sent for approval.");
      onOpenChange(false);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not send the request.", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog" aria-describedby="term-desc" data-testid="terminate-dialog">
          <div style={{ padding: "18px 20px", borderBottom: "1px solid var(--border)" }}>
            <Dialog.Title style={{ margin: 0, fontSize: 18 }}>Propose terminating {merchantName}</Dialog.Title>
            <p id="term-desc" className="muted" style={{ margin: "6px 0 0" }}>
              If approved, card processing stops at once. The reserve stays held through the dispute window to cover chargebacks on past sales, then the rest is paid out.
              {cat === "COMPLIANCE" ? " Compliance or the head of risk can approve." : " The head of risk must approve."}
            </p>
          </div>
          <div style={{ padding: 20, display: "grid", gap: 14 }}>
            <div className="field">
              <label htmlFor="cat">Reason</label>
              <select id="cat" className="input" value={cat} onChange={(e) => setCat(e.target.value)}>
                {CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="tnote">Evidence, for the approver</label>
              <textarea id="tnote" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you found, with dates and figures" />
            </div>
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <input type="checkbox" checked={list} onChange={(e) => setList(e.target.checked)} style={{ marginTop: 3 }} />
              <span>
                Add the merchant and its main owners to the terminated merchant list
                <span className="meta" style={{ display: "block" }}>Other providers check this list before onboarding. Needs compliance or head of risk approval.</span>
              </span>
            </label>
            <div>
              <div className="label" style={{ marginBottom: 4 }}>The merchant will read</div>
              <blockquote style={{ margin: 0, padding: "10px 12px", background: "var(--raised)", borderRadius: 6, border: "1px solid var(--border)" }}>{text}</blockquote>
            </div>
            <div className="field">
              <label htmlFor="confirm">Type the merchant&apos;s name to confirm</label>
              <input id="confirm" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={merchantName} autoComplete="off" />
            </div>
          </div>
          <div className="drawer-foot">
            <Dialog.Close className="btn">Cancel</Dialog.Close>
            <button className="btn danger" disabled={!ok || busy} onClick={submit} data-testid="terminate-submit">
              {busy ? "Sending…" : "Send for approval"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
