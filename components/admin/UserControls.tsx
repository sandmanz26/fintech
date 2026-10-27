"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client";
import { useToast } from "@/components/ui/Toast";

const ROLES = ["ANALYST", "SENIOR_ANALYST", "RISK_MANAGER", "COMPLIANCE", "AUDITOR", "ADMIN", "MERCHANT"];

export function UserRowControls({ id, role, active, self, labels, field }: { id: string; role: string; active: boolean; self: boolean; labels: Record<string, string>; field: "role" | "active" }) {
  const router = useRouter();
  const toast = useToast();
  async function patch(body: Record<string, unknown>) {
    try {
      await api(`/admin/users/${id}`, { method: "PATCH", body });
      toast("Saved.");
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not save.", "err");
    }
  }
  if (field === "role")
    return (
      <select aria-label="Role" className="input" style={{ height: 30, width: "auto" }} value={role} disabled={self} onChange={(e) => patch({ role: e.target.value })}>
        {ROLES.map((r) => <option key={r} value={r}>{labels[r]}</option>)}
      </select>
    );
  return (
    <span className="row-gap" style={{ flexWrap: "nowrap" }}>
      <span className={`pill ${active ? "" : "outline"}`}>{active ? "Active" : "Deactivated"}</span>
      {!self ? <button className="link meta" onClick={() => patch({ active: !active })}>{active ? "Deactivate" : "Reactivate"}</button> : null}
    </span>
  );
}

export function NewUserForm({ labels, merchants }: { labels: Record<string, string>; merchants: { id: string; name: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState({ name: "", email: "", role: "ANALYST", merchantId: "" });
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/admin/users", { body: { ...f, merchantId: f.role === "MERCHANT" ? f.merchantId || null : null } });
      toast("User added.");
      setF({ name: "", email: "", role: "ANALYST", merchantId: "" });
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not add the user.", "err");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
      <div className="field"><label htmlFor="nu-name">Name</label><input id="nu-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></div>
      <div className="field"><label htmlFor="nu-email">Email</label><input id="nu-email" type="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></div>
      <div className="field">
        <label htmlFor="nu-role">Role</label>
        <select id="nu-role" className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
          {ROLES.map((r) => <option key={r} value={r}>{labels[r]}</option>)}
        </select>
      </div>
      {f.role === "MERCHANT" ? (
        <div className="field">
          <label htmlFor="nu-m">Merchant</label>
          <select id="nu-m" className="input" value={f.merchantId} onChange={(e) => setF({ ...f, merchantId: e.target.value })}>
            <option value="">Choose…</option>
            {merchants.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
      ) : null}
      <button className="btn primary" disabled={busy}>Add user</button>
    </form>
  );
}
