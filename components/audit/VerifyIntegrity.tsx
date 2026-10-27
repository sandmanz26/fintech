"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client";
import { useToast } from "@/components/ui/Toast";

export function VerifyIntegrity() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; checked: number; firstBrokenId?: string; reason?: string; durationMs: number } | null>(null);
  async function run() {
    setBusy(true);
    try {
      const r = await api<NonNullable<typeof result>>("/audit/verify", { body: {} });
      setResult(r);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Verification failed to run.", "err");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="row-gap">
      {result ? (
        <span role="status" data-testid="verify-result" style={{ color: result.ok ? "var(--positive)" : "var(--negative)", fontWeight: 500 }}>
          {result.ok ? `Intact: ${result.checked.toLocaleString()} entries checked` : `Broken at entry ${result.firstBrokenId} (${result.reason === "chain_break" ? "chain break" : "hash mismatch"})`}
        </span>
      ) : null}
      <button className="btn primary" disabled={busy} onClick={run} data-testid="verify-integrity">{busy ? "Verifying…" : "Verify integrity"}</button>
    </div>
  );
}
