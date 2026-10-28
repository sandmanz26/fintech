"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { api, ApiError, toMinor, fromMinor } from "@/lib/client";
import { useToast } from "@/components/ui/Toast";
import { useRequired, FieldHint } from "@/components/ui/Required";

export type DeclaredProfile = { monthlyMinor: string; ticketMinor: string; deliveryDays: number };

/** Update the declared profile the rules compare against. Says what changes before the click. */
export function ProfileDialog({ merchantId, profile, open, onOpenChange }: { merchantId: string; profile: DeclaredProfile; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const toast = useToast();
  const [monthly, setMonthly] = useState(fromMinor(profile.monthlyMinor));
  const [ticket, setTicket] = useState(fromMinor(profile.ticketMinor));
  const [days, setDays] = useState(String(profile.deliveryDays));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const m = toMinor(monthly);
  const t = toMinor(ticket);
  const d = /^\d+$/.test(days) ? Number(days) : null;
  const changed = m !== profile.monthlyMinor || t !== profile.ticketMinor || d !== profile.deliveryDays;
  const reqNum = useRequired("pm");
  const reqNote = useRequired("pn");

  async function submit() {
    if (!reqNum.check(!!m && !!t && d !== null, "Enter amounts like 125000 or 125,000.50 and whole days.")) return;
    if (!reqNum.check(changed, "Nothing changed yet: edit at least one figure.")) return;
    if (!reqNote.check(note.trim().length >= 10, "Say what evidence supports the new profile (at least 10 characters).")) return;
    setBusy(true);
    try {
      const r = await api<{ score: number; band: string; previousBand: string | null }>(`/merchants/${merchantId}/profile`, {
        method: "PATCH",
        body: { expectedMonthlyVolumeMinor: m, expectedAvgTicketMinor: t, avgDeliveryDays: d, note },
      });
      toast(`Profile updated and re-scored: ${r.score} (${r.band.toLowerCase()})${r.previousBand && r.previousBand !== r.band ? `, was ${r.previousBand.toLowerCase()}` : ""}.`);
      onOpenChange(false);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not update the profile.", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog" aria-describedby="prof-desc" data-testid="profile-dialog">
          <div style={{ padding: "18px 20px", borderBottom: "1px solid var(--border)" }}>
            <Dialog.Title style={{ margin: 0, fontSize: 18 }}>Update declared profile</Dialog.Title>
            <p id="prof-desc" className="muted" style={{ margin: "6px 0 0" }}>
              Volume and ticket rules compare against these figures, and the score uses them. The merchant is re-scored as soon as you save; the change and your reason go in the audit log.
            </p>
          </div>
          <div style={{ padding: 20, display: "grid", gap: 14 }}>
            <div className="field">
              <label htmlFor="pm">Monthly volume</label>
              <input id="pm" className="input money" inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="pt">Average ticket</label>
              <input id="pt" className="input money" inputMode="decimal" value={ticket} onChange={(e) => setTicket(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="pd">Average days to delivery</label>
              <input id="pd" className="input num" inputMode="numeric" value={days} onChange={(e) => (setDays(e.target.value), reqNum.clear())} />
              <FieldHint error={reqNum.error} />
            </div>
            <div className="field">
              <label htmlFor="pn">Evidence, for the file</label>
              <textarea id="pn" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: three months of processing statements show steady growth to this level" onInput={() => reqNote.clear()} />
              <FieldHint error={reqNote.error} />
            </div>
          </div>
          <div className="drawer-foot">
            <Dialog.Close className="btn">Cancel</Dialog.Close>
            <button className="btn primary" disabled={busy} onClick={submit} data-testid="profile-submit">
              {busy ? "Saving…" : "Save and re-score"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
