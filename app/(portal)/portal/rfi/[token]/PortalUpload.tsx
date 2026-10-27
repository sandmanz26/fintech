"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function PortalUpload({ token, itemKey, label, received }: { token: string; itemKey: string; label: string; received: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ kind: "idle" | "busy" | "err" | "ok"; text?: string }>({ kind: "idle" });
  async function onPick(f: File | undefined) {
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) {
      setState({ kind: "err", text: "That file is over 10 MB." });
      return;
    }
    setState({ kind: "busy" });
    const form = new FormData();
    form.set("itemKey", itemKey);
    form.set("file", f);
    try {
      const res = await fetch(`/api/v1/portal/rfi/${token}/upload`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Upload failed.");
      setState({ kind: "ok", text: `${f.name} uploaded.` });
      router.refresh();
    } catch (e) {
      setState({ kind: "err", text: e instanceof Error ? e.message : "Upload failed." });
    }
  }
  return (
    <div style={{ marginTop: 10 }}>
      <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" id={`f-${itemKey}`} onChange={(e) => onPick(e.target.files?.[0])} data-testid={`upload-${itemKey}`} />
      <label htmlFor={`f-${itemKey}`} className="btn" style={{ height: 44, width: "100%" }} aria-label={`Upload ${label}`}>
        {state.kind === "busy" ? "Uploading…" : received ? "Upload another file" : "Choose a file"}
      </label>
      {state.text ? (
        <div role={state.kind === "err" ? "alert" : "status"} style={{ marginTop: 6, fontSize: 13, color: state.kind === "err" ? "var(--negative)" : "var(--positive)" }}>
          {state.text}
        </div>
      ) : null}
    </div>
  );
}
