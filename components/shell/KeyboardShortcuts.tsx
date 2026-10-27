"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Keyboard work (PRD §9): j/k move through queue rows, Enter opens, a assigns the
 * current row (or the open case) to me, n jumps to the note box, ? shows this help.
 * Rows opt in with data-row and data-href; actions opt in with data-shortcut.
 */
export function KeyboardShortcuts() {
  const router = useRouter();
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable=true]") || e.metaKey || e.ctrlKey || e.altKey) return;
      const rows = [...document.querySelectorAll<HTMLElement>("[data-row]")];
      const current = document.activeElement?.closest<HTMLElement>("[data-row]") ?? null;
      const idx = current ? rows.indexOf(current) : -1;
      if (e.key === "j" || e.key === "k") {
        if (!rows.length) return;
        e.preventDefault();
        const next = e.key === "j" ? Math.min(rows.length - 1, idx + 1) : Math.max(0, idx < 0 ? 0 : idx - 1);
        rows[next].focus();
        rows[next].scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter" && current?.dataset.href) {
        e.preventDefault();
        router.push(current.dataset.href);
      } else if (e.key === "a") {
        const btn = (current?.querySelector<HTMLElement>("[data-shortcut=assign]") ?? document.querySelector<HTMLElement>("[data-shortcut=assign-page]")) || null;
        if (btn) {
          e.preventDefault();
          btn.click();
        }
      } else if (e.key === "n") {
        const box = document.querySelector<HTMLElement>("[data-shortcut=note]");
        if (box) {
          e.preventDefault();
          box.focus();
        }
      } else if (e.key === "?") {
        setHelp((h) => !h);
      } else if (e.key === "Escape") {
        setHelp(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);
  if (!help) return null;
  return (
    <div role="dialog" aria-label="Keyboard shortcuts" className="dialog" style={{ padding: 20, top: "20vh" }}>
      <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>Keyboard shortcuts</h2>
      <dl className="kv left" style={{ gridTemplateColumns: "80px 1fr" }}>
        <dt><span className="kbd">j</span> <span className="kbd">k</span></dt><dd>Next / previous row</dd>
        <dt><span className="kbd">Enter</span></dt><dd>Open the row</dd>
        <dt><span className="kbd">a</span></dt><dd>Assign to me</dd>
        <dt><span className="kbd">n</span></dt><dd>Write a note</dd>
        <dt><span className="kbd">?</span></dt><dd>Show or hide this help</dd>
      </dl>
    </div>
  );
}
