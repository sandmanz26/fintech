"use client";

import { createContext, useCallback, useContext, useState } from "react";

type Toast = { id: number; text: string; tone: "ok" | "err" };
const Ctx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});

/** Quiet confirmations after an action; errors stay until dismissed. Announced to screen readers. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, text, tone }]);
    if (tone === "ok") setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" style={{ position: "fixed", right: 16, bottom: 16, display: "grid", gap: 8, zIndex: 70, maxWidth: "min(420px, calc(100vw - 32px))" }}>
        {items.map((t) => (
          <div key={t.id} className="menu" role={t.tone === "err" ? "alert" : "status"} style={{ padding: "10px 12px", display: "flex", gap: 12, alignItems: "flex-start", minWidth: 0 }}>
            <span style={{ flex: 1, color: t.tone === "err" ? "var(--negative)" : "var(--text)" }}>{t.text}</span>
            <button className="link meta" onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}>
              Dismiss
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
