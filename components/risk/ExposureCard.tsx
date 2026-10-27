import { formatMoney } from "@/lib/money";
import { fmtPct } from "@/lib/format";

type Exposure = {
  adv: bigint;
  advSource: "actual_30d" | "declared_monthly";
  futureDelivery: bigint;
  disputeExposure: bigint;
  totalExposure: bigint;
  reserveBalance: bigint;
  coverage: number;
  formulas: { futureDelivery: string; disputeExposure: string };
  currency: string;
  cbRatePpm?: number;
  refundRatePpm?: number;
};

const ppmPct = (ppm: number) => `${(ppm / 10_000).toFixed(2)}%`;

/**
 * Exposure against reserve (DESIGN.md §2.1, PRD §6.5): every component is shown, not only the
 * total. One track as long as total exposure: future delivery and dispute segments, with the
 * reserve drawn over it.
 */
export function ExposureCard({ e, action }: { e: Exposure; action?: React.ReactNode }) {
  const total = Number(e.totalExposure);
  const fdPct = total ? (Number(e.futureDelivery) / total) * 100 : 0;
  const covPct = Math.min(100, e.coverage * 100);
  const m = (v: bigint) => formatMoney(v, e.currency);
  return (
    <section className="panel" aria-labelledby="exp-h" data-testid="exposure-card">
      <header>
        <div>
          <h2 id="exp-h">Exposure</h2>
          <div className="meta">If the merchant could not cover refunds and chargebacks</div>
        </div>
        {action}
      </header>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <span className="money" style={{ fontSize: 24, fontWeight: 600 }}>{m(e.totalExposure)}</span>
        <span className="muted num">
          reserve covers <strong style={{ color: e.coverage < 0.25 && total > 0 ? "var(--negative)" : "var(--text)" }}>{total ? fmtPct(e.coverage, 0) : "—"}</strong>
        </span>
      </div>
      <div style={{ margin: "10px 0 4px", position: "relative", height: 12, display: "flex", gap: 2 }} role="img" aria-label={`Future delivery ${m(e.futureDelivery)}, dispute exposure ${m(e.disputeExposure)}, reserve ${m(e.reserveBalance)}`}>
        {total ? (
          <>
            <div style={{ flex: Math.max(0.001, fdPct), background: "var(--active)", borderRadius: 2 }} />
            <div style={{ flex: Math.max(0.001, 100 - fdPct), background: "var(--rule)", borderRadius: 2, boxShadow: "inset 0 0 0 1px var(--border)" }} />
            <div style={{ position: "absolute", left: 0, top: 3, height: 6, width: `${covPct}%`, background: "var(--data)", borderRadius: 2 }} />
          </>
        ) : (
          <div style={{ flex: 1, background: "var(--rule)", borderRadius: 2 }} />
        )}
      </div>
      <dl className="kv" style={{ marginTop: 10 }}>
        <dt>
          Average daily volume
          <div className="meta">{e.advSource === "actual_30d" ? "Settled, last 30 days" : "Declared monthly volume ÷ 30"}</div>
        </dt>
        <dd className="money">{m(e.adv)}</dd>
        <dt>
          <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "var(--active)", marginRight: 6, boxShadow: "inset 0 0 0 1px var(--control)" }} />
          Future delivery
          <div className="meta">{e.formulas.futureDelivery}</div>
        </dt>
        <dd className="money">{m(e.futureDelivery)}</dd>
        <dt>
          <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "var(--rule)", marginRight: 6, boxShadow: "inset 0 0 0 1px var(--control)" }} />
          Dispute exposure
          <div className="meta">
            {e.cbRatePpm !== undefined && e.refundRatePpm !== undefined
              ? `ADV × ${e.formulas.disputeExposure.match(/× (\d+) days/)?.[1] ?? "120"} days × (${ppmPct(e.cbRatePpm)} chargebacks + ${ppmPct(e.refundRatePpm)} refunds)`
              : e.formulas.disputeExposure}
          </div>
        </dt>
        <dd className="money">{m(e.disputeExposure)}</dd>
        <dt>
          <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "var(--data)", marginRight: 6 }} />
          Reserve balance
          <div className="meta">From the reserve ledger</div>
        </dt>
        <dd className="money">{m(e.reserveBalance)}</dd>
      </dl>
    </section>
  );
}
