"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client";
import { useToast } from "@/components/ui/Toast";
import { useRequired, FieldHint, NOTE_MIN, noteMessage } from "@/components/ui/Required";

/** Note composer. "@Laura" mentions notify that person. Shortcut: n. */
export function NoteBox({ caseId, users }: { caseId: string; users: string[] }) {
  const router = useRouter();
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const firstNames = [...new Set(users.map((u) => u.split(" ")[0]))];
  const at = /@(\w*)$/.exec(text);
  const suggestions = at ? firstNames.filter((n) => n.toLowerCase().startsWith(at[1].toLowerCase())).slice(0, 5) : [];
  const req = useRequired("note-box");
  async function save() {
    if (!req.check(!!text.trim(), "Type the note first.")) return;
    setBusy(true);
    try {
      await api(`/cases/${caseId}/notes`, { body: { body: text } });
      setText("");
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not save the note.", "err");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ display: "grid", gap: 6, position: "relative" }}>
      <label htmlFor="note-box" className="sr-only">Add a note</label>
      <textarea
        id="note-box"
        data-shortcut="note"
        className="input"
        style={{ minHeight: 64 }}
        placeholder="Add a note. Type @ to mention someone."
        value={text}
        onChange={(e) => (setText(e.target.value), req.clear())}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) save();
        }}
      />
      {suggestions.length ? (
        <div className="row-gap" role="listbox" aria-label="Mention">
          {suggestions.map((s) => (
            <button key={s} type="button" role="option" aria-selected={false} className="chip" onClick={() => setText(text.replace(/@\w*$/, `@${s} `))}>@{s}</button>
          ))}
        </div>
      ) : null}
      <FieldHint error={req.error} />
      <div className="row-gap" style={{ justifyContent: "space-between" }}>
        <span className="meta">Ctrl+Enter to save</span>
        <button className="btn sm" disabled={busy} onClick={save} data-testid="save-note">Add note</button>
      </div>
    </div>
  );
}
