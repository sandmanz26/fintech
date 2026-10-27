import { describe, it, expect } from "vitest";
import { networkFigures, networkHistoryStart, buildMetricContext, type DayRow } from "@/lib/domain/metrics/context";
import { networkLines } from "@/lib/domain/policy";
import { DEFAULT_POLICY } from "@/lib/domain/policy/defaults";
import { addDays, isoDay } from "@/lib/domain/reserves/calc";

/** One row per day from `from` to `to` inclusive, with the same network counts every day. */
function days(from: string, to: string, f: Partial<DayRow>): DayRow[] {
  const out: DayRow[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); isoDay(d) <= to; d = addDays(d, 1)) {
    out.push({ date: isoDay(d), gross: 0, settled: 0, attempts: 0, declines: 0, refunds: 0, chargebacks: 0, crossBorderPct: 0, smallAuth: 0, ...f });
  }
  return out;
}

describe("Visa VAMP", () => {
  it("counts fraud reports and disputes over settled card-not-present Visa sales", () => {
    const rows = days("2026-09-01", "2026-10-27", { visaCnp: 100, visaDisputes: 1, visaFraud: 1, visaOverlap: 0 });
    const f = networkFigures(rows, "2026-10-27", true);
    expect(f.vamp30).toMatchObject({ count: 60, denominator: 3000, ratio: 0.02, basis: "Rolling 30 days" });
    // September in full: 30 days.
    expect(f.vampLastMonth).toMatchObject({ count: 60, denominator: 3000, basis: "Sep" });
  });
  it("policy decides whether a fraud dispute with a fraud report counts once or twice", () => {
    const rows = days("2026-10-01", "2026-10-27", { visaCnp: 100, visaDisputes: 2, visaFraud: 2, visaOverlap: 1 });
    expect(networkFigures(rows, "2026-10-27", true).vamp30.count).toBe(27 * 4);
    expect(networkFigures(rows, "2026-10-27", false).vamp30.count).toBe(27 * 3);
  });
  it("is null, not zero, for a merchant with no card-not-present Visa sales", () => {
    const rows = days("2026-10-01", "2026-10-27", { visaCnp: 0, visaDisputes: 0 });
    expect(networkFigures(rows, "2026-10-27", true).vamp30.ratio).toBeNull();
  });
});

describe("Mastercard ECM", () => {
  it("divides this month's chargebacks by last month's Mastercard sales", () => {
    const rows = [
      ...days("2026-08-01", "2026-08-31", { mcSettled: 50, mcCb: 0 }),
      ...days("2026-09-01", "2026-09-30", { mcSettled: 100, mcCb: 1 }),
      ...days("2026-10-01", "2026-10-10", { mcSettled: 200, mcCb: 3 }),
    ];
    const f = networkFigures(rows, "2026-10-10", true);
    // October so far: 30 chargebacks over September's 3,000 sales.
    expect(f.ecmMonthToDate).toMatchObject({ count: 30, denominator: 3000, ratio: 0.01, basis: "Oct so far" });
    // September: 30 chargebacks over August's 1,550 sales.
    expect(f.ecmLastMonth.count).toBe(30);
    expect(f.ecmLastMonth.denominator).toBe(1550);
  });
  it("history reaches back to the first day of the month two months earlier", () => {
    expect(isoDay(networkHistoryStart(new Date("2026-10-27T00:00:00Z")))).toBe("2026-08-01");
    expect(isoDay(networkHistoryStart(new Date("2026-01-05T00:00:00Z")))).toBe("2025-11-01");
  });
});

describe("metric context", () => {
  it("exposes program figures and policy lines to the rules", () => {
    const lines = networkLines(DEFAULT_POLICY);
    const rows = days("2026-08-01", "2026-10-27", { settled: 100, visaCnp: 60, visaDisputes: 1, mcSettled: 30, mcCb: 1 });
    const ctx = buildMetricContext(rows, "2026-10-27", { expectedAvgTicketMinor: 1000, expectedMonthlyVolumeMinor: 100000, isDomestic: true }, { lines, volSpikeAlerts14d: 0, lastTxnDate: "2026-10-27" });
    expect(ctx.vamp_ratio_30d).toBeCloseTo(1 / 60);
    expect(ctx.vamp_warning_line).toBeCloseTo(0.012);
    expect(ctx.mc_ecm_line).toBe(0.015);
    expect(ctx.mc_ecm_min_count).toBe(100);
    expect(ctx.network_min_count).toBe(10);
    expect(ctx.mc_cb_count_mtd).toBe(27);
  });
});
