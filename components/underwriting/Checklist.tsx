"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiError } from "@/lib/client";
import { useToast } from "@/components/ui/Toast";
import { useRequired, FieldHint, NOTE_MIN } from "@/components/ui/Required";
import type { ChecklistItem } from "@/lib/domain/underwriting/checklist";

const TONE: Record<string, string> = { PASS: "", FAIL: "neg", WAIVED: "outline", PENDING: "warn" };
const WORD: Record<string, string> = { PASS: "Pass", FAIL: "Fail", WAIVED: "Waived", PENDING: "To do" };

export function Checklist({ applicationId, merchantId, items, editable, users }: { applicationId: string; merchantId: string; items: ChecklistItem[]; editable: boolean; users: Record<string, string> }) {
  const required = items.filter((i) => i.required);
  const optional = items.filter((i) => !i.required);
  const done = required.filter((i) => i.status === "PASS" || i.status === "WAIVED").length;
  return (
    <section className="panel" aria-labelledby="cl-h">
      <header>
        <div>
          <h2 id="cl-h">Due diligence</h2>
          <div className="meta">Required items depend on the risk band</div>
        </div>
        <span className="num" data-testid="checklist-progress">
          <strong>{done}</strong> <span className="muted">of {required.length} required done</span>
        </span>
      </header>
      <div aria-hidden style={{ height: 4, background: "var(--rule)", borderRadius: 2, marginBottom: 6 }}>
        <div style={{ height: 4, width: `${required.length ? (done / required.length) * 100 : 0}%`, background: "var(--text)", borderRadius: 2 }} />
      </div>
      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {required.map((i) => (
          <Row key={i.key} item={i} applicationId={applicationId} merchantId={merchantId} editable={editable} users={users} />
        ))}
      </ol>
      {optional.length ? (
        <details style={{ marginTop: 6 }}>
          <summary className="muted" style={{ cursor: "pointer", padding: "8px 0" }}>{optional.length} not required for this band</summary>
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {optional.map((i) => (
              <Row key={i.key} item={i} applicationId={applicationId} merchantId={merchantId} editable={editable} users={users} />
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}

function Row({ item, applicationId, merchantId, editable, users }: { item: ChecklistItem; applicationId: string; merchantId: string; editable: boolean; users: Record<string, string> }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const req = useRequired(`n-${item.key}`);
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);
  const auto = item.key === "screening_clear";
  const settled = item.status === "PASS" || item.status === "WAIVED";
  async function save(status: string, n?: string) {
    setBusy(true);
    try {
      await api(`/applications/${applicationId}/checklist/${item.key}`, { method: "PATCH", body: { status, note: n } });
      setPending(null);
      setNote("");
      setChanging(false);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not save.", "err");
    } finally {
      setBusy(false);
    }
  }
  return (
    <li style={{ borderTop: "1px solid var(--rule)", padding: "12px 0" }} data-testid={`check-${item.key}`} data-status={item.status}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500 }}>{item.label}</div>
          <div className="meta">{item.source}{item.auto ? " · checked automatically" : ""}</div>
          {item.evidence ? <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{item.evidence}</div> : null}
          {item.note ? (
            <div style={{ fontSize: 13, marginTop: 2 }}>
              “{item.note}” <span className="meta">{item.updatedById ? `· ${users[item.updatedById] ?? ""}` : ""}</span>
            </div>
          ) : null}
        </div>
        <span className={`pill ${TONE[item.status]}`}>{WORD[item.status]}</span>
      </div>
      {editable && !auto && settled && !changing ? (
        <button className="link meta" style={{ marginTop: 6 }} onClick={() => setChanging(true)}>Change</button>
      ) : editable && !auto ? (
        <div className="row-gap" style={{ marginTop: 8 }}>
          <button className="btn sm" disabled={busy || item.status === "PASS"} title={item.status === "PASS" ? "Already passed" : undefined} onClick={() => save("PASS")} data-testid={`pass-${item.key}`}>Pass</button>
          <button className="btn sm ghost" disabled={busy} onClick={() => setPending(pending === "FAIL" ? null : "FAIL")}>Fail</button>
          <button className="btn sm ghost" disabled={busy} onClick={() => setPending(pending === "WAIVED" ? null : "WAIVED")}>Waive</button>
        </div>
      ) : auto && item.status !== "PASS" ? (
        <div style={{ marginTop: 6 }}>
          <Link className="link" href={`/merchants/${merchantId}/ownership`}>Review the matches on the Ownership tab</Link>
        </div>
      ) : null}
      {pending ? (
        <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
          <label className="sr-only" htmlFor={`n-${item.key}`}>Note</label>
          <textarea id={`n-${item.key}`} className="input" style={{ minHeight: 56 }} value={note} onChange={(e) => (setNote(e.target.value), req.clear())} placeholder={pending === "WAIVED" ? "Why this item can be waived" : "What failed"} />
          <FieldHint error={req.error} hint={pending === "WAIVED" ? "Required: why the item can be waived." : undefined} />
          <div className="row-gap">
            <button className="btn sm primary" disabled={busy} onClick={() => (pending !== "WAIVED" || req.check(note.trim().length >= NOTE_MIN, "Say why this item can be waived; the reason is kept with the decision.")) && save(pending, note)}>
              {pending === "WAIVED" ? "Waive item" : "Mark failed"}
            </button>
            <button className="btn sm ghost" onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
