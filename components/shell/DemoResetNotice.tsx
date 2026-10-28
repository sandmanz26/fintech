"use client";

import { useEffect, useState } from "react";

/**
 * Demo mode keeps changes in the server's memory. A serverless host can recycle an idle server,
 * and the next request then lands on a fresh copy of the demo data. Say so plainly, instead of
 * letting the next button fail with "not found".
 */
export function DemoResetNotice() {
  const [reset, setReset] = useState(false);
  useEffect(() => {
    const on = () => setReset(true);
    window.addEventListener("sentinel:demo-reset", on);
    return () => window.removeEventListener("sentinel:demo-reset", on);
  }, []);
  if (!reset) return null;
  return (
    <div role="alert" className="notice" data-testid="demo-reset" style={{ position: "fixed", left: "50%", top: 12, transform: "translateX(-50%)", zIndex: 80, maxWidth: "min(560px, calc(100vw - 32px))", display: "flex", gap: 12, alignItems: "center" }}>
      <span>The demo server restarted, so its data went back to the starting point. Your last action may not have been saved.</span>
      <button className="btn sm" onClick={() => window.location.reload()}>Reload</button>
    </div>
  );
}
