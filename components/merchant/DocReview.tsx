"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/client";
import { useToast } from "@/components/ui/Toast";

export function DocReview({ docId }: { docId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function set(status: "ACCEPTED" | "REJECTED") {
    setBusy(true);
    try {
      await api(`/documents/${docId}/review`, { body: { status } });
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not save.", "err");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className="btn sm" disabled={busy} onClick={() => set("ACCEPTED")} data-testid={`accept-doc-${docId}`}>Accept</button>
      <button className="btn sm ghost" disabled={busy} onClick={() => set("REJECTED")}>Reject</button>
    </>
  );
}
