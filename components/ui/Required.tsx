"use client";

import { useState } from "react";

/**
 * "Explain, don't disable": buttons that need input stay clickable; a click with the input
 * missing says what is needed next to the field and moves focus there. A greyed-out button with
 * no reason read as broken in testing.
 */
export function useRequired(fieldId: string) {
  const [error, setError] = useState<string | null>(null);
  return {
    error,
    clear: () => setError(null),
    /** True when `ok`; otherwise shows `message` and focuses the field. */
    check(ok: boolean, message: string) {
      if (ok) {
        setError(null);
        return true;
      }
      setError(message);
      const el = document.getElementById(fieldId) as HTMLElement | null;
      el?.focus();
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      return false;
    },
  };
}

/** The line under a field: the requirement as a hint, or the error after a premature click. */
export function FieldHint({ id, error, hint }: { id?: string; error: string | null; hint?: string }) {
  if (!error && !hint) return null;
  return (
    <div id={id} role={error ? "alert" : undefined} className="meta" style={{ marginTop: 4, color: error ? "var(--negative)" : undefined }} data-testid={error ? "field-error" : undefined}>
      {error ?? hint}
    </div>
  );
}

export const NOTE_MIN = 3;
export const noteMessage = "Write a short reason first. It goes into the audit log with your name.";
