import type { MetricContext } from "@/lib/domain/rules/dsl";
import { addDays, isoDay } from "@/lib/domain/reserves/calc";

/** One day of aggregates, as numbers (minor units are safe integers well below 2^53). */
export type DayRow = {
  date: string; // YYYY-MM-DD
  gross: number;
  settled: number;
  attempts: number;
  declines: number;
  refunds: number;
  chargebacks: number;
  crossBorderPct: number; // 0-100
  smallAuth: number;
};

export type MerchantFacts = {
  expectedAvgTicketMinor: number;
  expectedMonthlyVolumeMinor: number;
  isDomestic: boolean;
};

const sum = (rows: DayRow[], f: (r: DayRow) => number) => rows.reduce((a, r) => a + f(r), 0);
const safeDiv = (a: number, b: number) => (b === 0 ? null : a / b);

/**
 * Build the rule-engine metric context for one merchant on `date` (PRD §6.3 derived metrics).
 * `rows` holds up to the last 31 days ending on `date`; missing days count as zero activity.
 * Pure, shared by the daily monitoring job and the backtest.
 */
export function buildMetricContext(
  rows: DayRow[],
  date: string,
  facts: MerchantFacts,
  extras: { networkThresholdRatio: number; volSpikeAlerts14d: number; lastTxnDate: string | null },
): MetricContext {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const d0 = new Date(`${date}T00:00:00Z`);
  const window = (fromBack: number, toBack: number) => {
    const out: DayRow[] = [];
    for (let i = fromBack; i >= toBack; i--) {
      const r = byDate.get(isoDay(addDays(d0, -i)));
      if (r) out.push(r);
    }
    return out;
  };
  const today = byDate.get(date);
  const last7 = window(6, 0);
  const last30 = window(29, 0);
  const prior30 = window(30, 1); // excludes today
  const gross30 = sum(last30, (r) => r.gross);
  const settled30 = sum(last30, (r) => r.settled);
  const settled7 = sum(last7, (r) => r.settled);
  // Average over the days the merchant actually existed in the window (one row per active day).
  const avg30 = prior30.length ? sum(prior30, (r) => r.gross) / prior30.length : null;
  const xb7 = settled7 ? sum(last7, (r) => (r.crossBorderPct / 100) * r.settled) / settled7 : null;
  const daysSince =
    facts && extras.lastTxnDate
      ? Math.round((d0.getTime() - new Date(`${extras.lastTxnDate}T00:00:00Z`).getTime()) / 86_400_000)
      : 31;

  return {
    gross_volume_1d: today?.gross ?? 0,
    gross_volume_7d: sum(last7, (r) => r.gross),
    gross_volume_30d: gross30,
    avg_gross_volume_30d: avg30,
    settled_count_1d: today?.settled ?? 0,
    settled_count_30d: settled30,
    chargeback_count_30d: sum(last30, (r) => r.chargebacks),
    cb_ratio_30d: safeDiv(sum(last30, (r) => r.chargebacks), settled30),
    refund_ratio_30d: safeDiv(sum(last30, (r) => r.refunds), settled30),
    decline_rate_1d: today ? safeDiv(today.declines, today.attempts) : null,
    auth_attempts_1d: today?.attempts ?? 0,
    small_auth_count_1d: today?.smallAuth ?? 0,
    avg_ticket_7d: safeDiv(sum(last7, (r) => r.gross), settled7),
    expected_avg_ticket: facts.expectedAvgTicketMinor,
    expected_monthly_volume: facts.expectedMonthlyVolumeMinor,
    volume_vs_expected_monthly: safeDiv(gross30, facts.expectedMonthlyVolumeMinor),
    cross_border_pct_7d: xb7,
    days_since_last_txn: Math.max(0, daysSince),
    is_domestic: facts.isDomestic ? 1 : 0,
    network_cb_threshold: extras.networkThresholdRatio,
    vol_spike_alerts_14d: extras.volSpikeAlerts14d,
  };
}
