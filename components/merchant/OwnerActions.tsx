"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client";
import { useToast } from "@/components/ui/Toast";

/** Reveal an owner's full date of birth and ID number; the server records every reveal. */
export function OwnerReveal({ merchantId, ownerId }: { merchantId: string; ownerId: string }) {
  const toast = useToast();
  const [shown, setShown] = useState(false);
  async function reveal() {
    try {
      const r = await api<{ dateOfBirth: string | null; idNumber: string | null }>(`/merchants/${merchantId}/owners/${ownerId}/reveal`, { body: {} });
      const row = document.querySelector(`[data-owner="${ownerId}"]`);
      const dob = row?.querySelector("[data-dob]");
      const idn = row?.querySelector("[data-idno]");
      if (dob) dob.textContent = r.dateOfBirth ? r.dateOfBirth.slice(0, 10) : "—";
      if (idn) idn.textContent = r.idNumber ?? "—";
      setShown(true);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not reveal.", "err");
    }
  }
  return shown ? <span className="meta">Shown, logged</span> : <button className="link meta" onClick={reveal}>Reveal</button>;
}

export function HitReview({ hitId, ownerName }: { hitId: string; ownerName: string }) {
  const router = useRouter();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function decide(status: "FALSE_POSITIVE" | "CONFIRMED") {
    if (note.trim().length < 3) {
      toast("Write how you reached this conclusion first.", "err");
      return;
    }
    setBusy(true);
    try {
      await api(`/watchlist-hits/${hitId}/review`, { body: { status, note } });
      toast(status === "CONFIRMED" ? "Match confirmed. The merchant has been re-scored." : "Marked as a false positive. The merchant has been re-scored.");
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not save.", "err");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
      <label className="sr-only" htmlFor={`hn-${hitId}`}>Review note for {ownerName}</label>
      <textarea id={`hn-${hitId}`} className="input" style={{ minHeight: 56 }} placeholder="Compare date of birth, nationality and other identifiers" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="row-gap">
        <button className="btn sm" disabled={busy} onClick={() => decide("FALSE_POSITIVE")}>Not the same person</button>
        <button className="btn sm danger" disabled={busy} onClick={() => decide("CONFIRMED")}>Confirm match</button>
        <span className="meta">Confirming makes the merchant prohibited and opens a compliance case.</span>
      </div>
    </div>
  );
}
