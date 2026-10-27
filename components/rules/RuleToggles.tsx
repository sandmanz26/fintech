"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/client";
import { useToast } from "@/components/ui/Toast";

/** Turn a rule on/off, or make an earlier version active again. Both are audited. */
export function RuleToggles({ ruleId, enabled, activateVersionId }: { ruleId: string; enabled?: boolean; activateVersionId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function patch(body: Record<string, unknown>, ok: string) {
    setBusy(true);
    try {
      await api(`/rules/${ruleId}`, { method: "PATCH", body });
      toast(ok);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not save.", "err");
    } finally {
      setBusy(false);
    }
  }
  if (activateVersionId) return <button className="btn sm" disabled={busy} onClick={() => patch({ activeVersionId: activateVersionId }, "Version activated.")}>Make active</button>;
  return (
    <button className="btn" disabled={busy} onClick={() => patch({ enabled: !enabled }, enabled ? "Rule turned off." : "Rule turned on.")}>
      {enabled ? "Turn off" : "Turn on"}
    </button>
  );
}
