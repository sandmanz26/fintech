"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Saved filters per queue, kept in this browser (a per-viewer convenience, not shared state). */
export function SavedView({ queue, current }: { queue: string; current: { type?: string; priority?: string } }) {
  const router = useRouter();
  const key = `sentinel:view:${queue}`;
  const [saved, setSaved] = useState<{ type?: string; priority?: string } | null>(null);
  useEffect(() => {
    try {
      const v = localStorage.getItem(key);
      if (v) setSaved(JSON.parse(v));
    } catch {
      /* storage unavailable */
    }
  }, [key]);
  const same = saved && saved.type === current.type && saved.priority === current.priority;
  const has = current.type || current.priority;
  return (
    <div className="row-gap">
      {saved && !same ? (
        <button
          className="btn sm ghost"
          onClick={() => {
            const p = new URLSearchParams(Object.entries(saved).filter(([, v]) => v) as [string, string][]);
            router.push(`/queues/${queue}${p.size ? `?${p}` : ""}`);
          }}
        >
          Use saved view
        </button>
      ) : null}
      {has && !same ? (
        <button
          className="btn sm"
          onClick={() => {
            try {
              localStorage.setItem(key, JSON.stringify(current));
              setSaved(current);
            } catch {
              /* ignore */
            }
          }}
        >
          Save this view
        </button>
      ) : same ? <span className="meta">Saved view</span> : null}
    </div>
  );
}
