import Link from "next/link";

/** Shown when a role opens a page it may not use. The server refuses the data too (RBAC in services). */
export function Forbidden({ what }: { what: string }) {
  return (
    <div style={{ maxWidth: 520, paddingTop: 40 }}>
      <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Not available for your role</h1>
      <p className="muted">Your role does not include access to {what}. If you need it, ask the system admin.</p>
      <Link className="btn" href="/dashboard">Back to dashboard</Link>
    </div>
  );
}
