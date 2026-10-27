"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client";
import { useToast } from "@/components/ui/Toast";

export function AssignToMe({ caseId, userId }: { caseId: string; userId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn sm"
      data-shortcut="assign"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api(`/cases/${caseId}/assign`, { body: { assigneeId: userId } });
          toast("Assigned to you.");
          router.refresh();
        } catch (e) {
          toast(e instanceof ApiError ? e.message : "Could not assign.", "err");
        } finally {
          setBusy(false);
        }
      }}
    >
      Assign to me
    </button>
  );
}

/** Bulk assign: reads the checked rows of the surrounding form. */
export function BulkAssign({ users }: { users: { id: string; name: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [to, setTo] = useState(users[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  async function run() {
    const ids = [...document.querySelectorAll<HTMLInputElement>('#bulk input[name="caseId"]:checked')].map((i) => i.value);
    if (!ids.length) {
      toast("Select one or more cases first.", "err");
      return;
    }
    setBusy(true);
    let ok = 0;
    for (const id of ids) {
      try {
        await api(`/cases/${id}/assign`, { body: { assigneeId: to } });
        ok++;
      } catch {
        /* reported below */
      }
    }
    toast(ok === ids.length ? `${ok} cases assigned.` : `${ok} of ${ids.length} assigned; the rest could not be.`, ok === ids.length ? "ok" : "err");
    setBusy(false);
    router.refresh();
  }
  return (
    <div className="row-gap" style={{ padding: "12px 20px", borderBottom: "1px solid var(--rule)" }}>
      <label htmlFor="bulk-to" className="muted">Assign selected to</label>
      <select id="bulk-to" className="input" style={{ width: 200, height: 32 }} value={to} onChange={(e) => setTo(e.target.value)}>
        {users.map((u) => (
          <option key={u.id} value={u.id}>{u.name}</option>
        ))}
      </select>
      <button type="button" className="btn" disabled={busy} onClick={run}>Assign</button>
    </div>
  );
}
