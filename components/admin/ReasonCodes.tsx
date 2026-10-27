"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client";
import { useToast } from "@/components/ui/Toast";

type RC = { code: string; category: string; label: string; merchantFacingText: string; active: boolean };

export function ReasonCodeRow({ rc, editable }: { rc: RC; editable: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState(rc);
  async function save(next: RC) {
    try {
      await api("/admin/reason-codes", { body: next });
      setEdit(false);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not save.", "err");
    }
  }
  if (edit)
    return (
      <tr>
        <td className="id">{rc.code}</td>
        <td><input aria-label="Label" className="input" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></td>
        <td><textarea aria-label="Merchant-facing text" className="input" style={{ minHeight: 56 }} value={f.merchantFacingText} onChange={(e) => setF({ ...f, merchantFacingText: e.target.value })} /></td>
        <td className="row-gap"><button className="btn sm primary" onClick={() => save(f)}>Save</button><button className="btn sm ghost" onClick={() => setEdit(false)}>Cancel</button></td>
      </tr>
    );
  return (
    <tr style={{ opacity: rc.active ? 1 : 0.7 }}>
      <td className="id">{rc.code}</td>
      <td>{rc.label}</td>
      <td data-line2 className="muted">{rc.merchantFacingText || "—"}</td>
      <td>
        <span className="row-gap" style={{ flexWrap: "nowrap" }}>
          <span className={`pill ${rc.active ? "" : "outline"}`}>{rc.active ? "In use" : "Retired"}</span>
          {editable ? <><button className="link meta" onClick={() => setEdit(true)}>Edit</button><button className="link meta" onClick={() => save({ ...rc, active: !rc.active })}>{rc.active ? "Retire" : "Restore"}</button></> : null}
        </span>
      </td>
    </tr>
  );
}

export function NewReasonCode({ categories }: { categories: Record<string, string> }) {
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState<RC>({ code: "", category: "CONTROL", label: "", merchantFacingText: "", active: true });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/admin/reason-codes", { body: f });
      toast("Reason code added.");
      setF({ ...f, code: "", label: "", merchantFacingText: "" });
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not add.", "err");
    }
  }
  return (
    <section className="panel" aria-labelledby="nrc-h">
      <h2 id="nrc-h" style={{ marginBottom: 12 }}>Add a reason code</h2>
      <form onSubmit={submit} className="grid-3" style={{ alignItems: "end" }}>
        <div className="field"><label htmlFor="nrc-code">Code</label><input id="nrc-code" className="input id" placeholder="CT-EXAMPLE" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></div>
        <div className="field"><label htmlFor="nrc-cat">Category</label><select id="nrc-cat" className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{Object.entries(categories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="field"><label htmlFor="nrc-label">Label</label><input id="nrc-label" className="input" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></div>
        <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="nrc-text">Merchant reads</label><textarea id="nrc-text" className="input" value={f.merchantFacingText} onChange={(e) => setF({ ...f, merchantFacingText: e.target.value })} /></div>
        <div><button className="btn primary">Add reason code</button></div>
      </form>
    </section>
  );
}
