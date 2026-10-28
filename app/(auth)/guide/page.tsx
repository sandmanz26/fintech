import Link from "next/link";
import { Mark } from "@/components/shell/Mark";

export const metadata = { title: "How it works" };

const STEPS: { n: string; title: string; who: string; what: string; where: string }[] = [
  { n: "1", title: "Apply", who: "The shop", what: "A shop asks to accept card payments through the payment company and declares what it sells, how much and how fast it delivers.", where: "Underwriting queues" },
  { n: "2", title: "Underwrite", who: "Rina, Dimas", what: "Sentinel checks the registry, website, owners and watchlists and scores the risk, factor by factor. A person finishes the checklist and approves, approves with conditions, or declines.", where: "Application page" },
  { n: "3", title: "Monitor", who: "Sentinel, every day", what: "Each day's transactions are added up per shop. Rules look for warning signs: a sudden volume spike, card testing, too many chargebacks, a website that starts selling something else.", where: "Alerts, cases" },
  { n: "4", title: "Investigate", who: "Rina", what: "An alert opens a case. The analyst reviews the evidence, asks the shop for documents through a secure link, and decides what to do.", where: "Case page" },
  { n: "5", title: "Act", who: "Rina, Dimas", what: "Controls protect the money: hold back part of the sales (a reserve), cap daily volume, delay or hold payouts. The screen shows the effect on the shop's cash before saving.", where: "Control editor" },
  { n: "6", title: "Approve", who: "Laura, Ahmad", what: "High-impact actions need a second person (four-eyes): the one who asks can never be the one who approves.", where: "Approvals" },
  { n: "7", title: "Offboard", who: "Ahmad, Laura", what: "If a shop must go, processing stops, the reserve is kept until late chargebacks can no longer arrive, and serious cases are listed so other providers can see them.", where: "Merchant, cases" },
];

const PEOPLE: [string, string][] = [
  ["Rina Halim · risk analyst", "Works the alert and case queues; decides low and medium applications."],
  ["Dimas Pratama · senior underwriter", "Decides high-risk applications; sets smaller reserves himself."],
  ["Laura Chen · head of risk", "Approves big actions; owns the rules, the policy and the portfolio view."],
  ["Ahmad Fauzi · compliance", "Handles sanctions and watchlist matches; approves compliance terminations."],
  ["Grace Okafor · auditor", "Reads everything, changes nothing; checks the audit log has not been tampered with."],
  ["Sam Torres · admin", "Users, roles and configuration."],
];

const TERMS: [string, string][] = [
  ["Payment facilitator (payfac)", "A company that lets many small shops accept cards under its own agreement with a bank. If a shop commits fraud, disappears, or customers get their money back, the payfac pays first. That is the risk this team manages."],
  ["Chargeback", "A cardholder disputes a payment and the bank takes the money back from the shop. Too many, and the card networks fine the payfac."],
  ["Visa VAMP and Mastercard ECM", "The card networks' monitoring programs. Each counts problems differently (Visa adds fraud reports; Mastercard compares with last month's sales). Sentinel shows both, each against its own line."],
  ["Risk score and band", "A number from 0 to 100 built from listed factors (business type, age, delivery time and so on). Every point is explained; there is no AI."],
  ["Alert and case", "An alert is one rule firing on one day. A case is the piece of work a person owns: it collects related alerts, notes, documents and the decision."],
  ["Reserve", "Money held back from a shop's sales so refunds and chargebacks can still be paid if the shop cannot. Rolling: a share of each day's sales, released later. Fixed: until a target amount is reached."],
  ["Four-eyes", "Two different people for one decision: one proposes, a second approves. Applied to payout holds, large reserves and terminations."],
  ["RFI", "Request for information: a secure link where the shop uploads documents. It sees only the list, the message and the due date."],
  ["Audit log", "Every decision with who, when, why and the before/after. Each entry is chained to the previous one, so an edit afterwards is detected."],
  ["Simulated calendar", "The demo runs on its own date. Next day (in the sidebar) simulates a day of card payments for 200 shops and runs every daily check."],
];

/** Plain-language explainer: what Sentinel is, the lifecycle, the people, the words. Public. */
export default function GuidePage() {
  return (
    <main style={{ minHeight: "100svh", padding: "40px 16px 64px" }}>
      <div style={{ width: "min(860px, 100%)", margin: "0 auto", display: "grid", gap: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Mark size={28} />
            <span style={{ fontSize: 18, fontWeight: 600 }}>Sentinel</span>
            <span className="muted">How it works</span>
          </div>
          <Link className="btn primary" href="/login">Try the demo</Link>
        </div>

        <section>
          <h1 style={{ fontSize: 28, lineHeight: "34px", fontWeight: 600, margin: "0 0 10px" }}>A workspace for the team that decides which shops may take card payments, and keeps watching them.</h1>
          <p className="muted" style={{ fontSize: 16, lineHeight: "24px", margin: 0 }}>
            Kestrel Pay (fictional) is a payment company that lets small online shops accept cards. When a shop goes wrong (fraud, angry customers asking for refunds, or simply vanishing after taking orders) Kestrel Pay pays the bill. Sentinel is where its risk team accepts shops, spots trouble early, acts with money controls, and proves afterwards who decided what and why.
          </p>
        </section>

        <section className="panel" aria-labelledby="flow-h">
          <h2 id="flow-h" style={{ marginBottom: 12 }}>The life of a shop, in seven steps</h2>
          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 0 }}>
            {STEPS.map((s, i) => (
              <li key={s.n} style={{ display: "grid", gridTemplateColumns: "32px 1fr", gap: 12, padding: "12px 0", borderTop: i ? "1px solid var(--rule)" : 0 }}>
                <span aria-hidden style={{ width: 28, height: 28, borderRadius: 14, background: "var(--primary)", color: "var(--primary-ink)", display: "grid", placeItems: "center", fontWeight: 600, fontSize: 13 }}>{s.n}</span>
                <span>
                  <span style={{ display: "block", fontWeight: 600 }}>
                    {s.title} <span className="meta" style={{ fontWeight: 400 }}>· {s.who} · {s.where}</span>
                  </span>
                  <span className="muted" style={{ display: "block", marginTop: 2 }}>{s.what}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className="panel" aria-labelledby="demo-h">
          <h2 id="demo-h" style={{ marginBottom: 10 }}>Using the demo</h2>
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }}>
            <li><strong>Start with a story.</strong> The sign-in page lists five real situations. Each button signs you in as the right person and opens the screen where the work starts.</li>
            <li><strong>You play several people.</strong> Some steps need someone else (a second approver). The dashboard&apos;s <em>Demo guide</em> shows the next step and a <em>Continue as …</em> button that switches person for you. Click your name in the sidebar to switch at any time.</li>
            <li><strong>Decisions need a reason.</strong> Approve, reject, dismiss, close and similar buttons ask for a short note first; it goes into the audit log. If one is missing, the screen tells you where.</li>
            <li><strong>Roles differ on purpose.</strong> An analyst cannot approve; an auditor can only read. Screens say so instead of offering buttons that would fail.</li>
            <li><strong>Move time.</strong> <em>Next day</em> in the sidebar simulates a day of payments and runs every check, so new alerts and cases appear.</li>
            <li><strong>Everything is made up.</strong> 200 fictional shops and people, about 180,000 recent card payments, disputes and fraud reports. Changes are kept in the server&apos;s memory and go back to the start when the server restarts.</li>
          </ul>
        </section>

        <section className="panel" aria-labelledby="who-h">
          <h2 id="who-h" style={{ marginBottom: 10 }}>Who is who</h2>
          <dl style={{ margin: 0, display: "grid", gap: 8 }}>
            {PEOPLE.map(([n, d]) => (
              <div key={n}>
                <dt style={{ fontWeight: 500 }}>{n}</dt>
                <dd className="muted" style={{ margin: 0 }}>{d}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="panel" aria-labelledby="terms-h">
          <h2 id="terms-h" style={{ marginBottom: 10 }}>Words you will see</h2>
          <dl style={{ margin: 0, display: "grid", gap: 10 }}>
            {TERMS.map(([t, d]) => (
              <div key={t}>
                <dt style={{ fontWeight: 500 }}>{t}</dt>
                <dd className="muted" style={{ margin: 0 }}>{d}</dd>
              </div>
            ))}
          </dl>
        </section>

        <div style={{ textAlign: "center" }}>
          <Link className="btn primary" href="/login">Try the demo</Link>
        </div>
      </div>
    </main>
  );
}
