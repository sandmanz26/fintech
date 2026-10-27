import { portalView } from "@/lib/domain/portal";
import { PortalUpload } from "./PortalUpload";

export const metadata = { title: "Documents requested", robots: { index: false } };
export const dynamic = "force-dynamic";

const longDate = (d: Date) => d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

/** Merchant portal (PRD §9): plain language, phone first, nothing internal. */
export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = await portalView(token);
  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "24px 16px 64px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24 }}>
        <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
          <rect width="32" height="32" rx="7" fill="var(--primary)" />
          <path d="M9 17l5 5 9-11" stroke="var(--primary-ink)" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={{ fontWeight: 600 }}>Kestrel Pay</span>
        <span className="muted">· secure document upload</span>
      </div>
      {v.state === "invalid" ? (
        <>
          <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>This link isn&apos;t valid</h1>
          <p className="muted">Check that you opened the whole link from our email, or reply to that email and we&apos;ll send a new one.</p>
        </>
      ) : (
        <>
          <h1 style={{ fontSize: 24, lineHeight: "30px", margin: "0 0 4px" }}>
            {v.state === "done" ? "Thank you, we have everything" : `Documents for ${v.merchantName}`}
          </h1>
          <p className="muted" style={{ margin: "0 0 20px" }}>
            {v.state === "done"
              ? "Our team will review what you sent and contact you if anything else is needed."
              : v.state === "expired"
                ? "This link has expired. Please reply to our email and we'll send a new one."
                : `Please send these by ${longDate(v.dueAt)}.${"overdue" in v && v.overdue ? " The date has passed, but you can still upload." : ""}`}
          </p>
          {v.state !== "done" ? (
            <blockquote style={{ margin: "0 0 20px", padding: "14px 16px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 15, lineHeight: "22px" }}>{v.message}</blockquote>
          ) : null}
          <section className="panel flush" aria-labelledby="items-h">
            <h2 id="items-h" style={{ fontSize: 16, padding: "16px 16px 4px", margin: 0 }}>What we need</h2>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {v.items.map((i) => (
                <li key={i.key} style={{ padding: "14px 16px", borderTop: "1px solid var(--rule)" }}>
                  <div style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "flex-start" }}>
                    <span style={{ fontSize: 15 }}>{i.label}{i.required ? "" : " (optional)"}</span>
                    {i.status === "RECEIVED" ? <span className="pill pos">Received</span> : <span className="pill warn">Needed</span>}
                  </div>
                  {v.state === "open" ? <PortalUpload token={token} itemKey={i.key} label={i.label} received={i.status === "RECEIVED"} /> : null}
                </li>
              ))}
            </ul>
          </section>
          <p className="meta" style={{ marginTop: 16 }}>PDF, JPG or PNG, up to 10 MB each. Files go straight to our risk team over an encrypted connection.</p>
        </>
      )}
    </main>
  );
}
