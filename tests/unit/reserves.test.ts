import { describe, it, expect } from "vitest";
import {
  holdForDay,
  releaseDateFor,
  computeExposure,
  averageDailyVolume,
  simulate,
  controlNeedsApproval,
  appliesOn,
  isoDay,
  addDays,
  isReserve,
  type ControlLike,
} from "@/lib/domain/reserves/calc";
import { DEFAULT_POLICY } from "@/lib/domain/policy/defaults";

const day0 = new Date("2026-11-01T00:00:00Z");
const ctrl = (type: string, params: Record<string, unknown>, over: Partial<ControlLike> = {}): ControlLike => ({
  id: `${type}-1`,
  type,
  params,
  effectiveFrom: day0,
  ...over,
});

describe("holdForDay", () => {
  it("rolling reserve holds pct of settled volume, rounding half up", () => {
    expect(holdForDay(ctrl("ROLLING_RESERVE", { pctBps: 1000, holdDays: 120 }), 100_005n, 0n, 0n)).toBe(10_001n);
  });
  it("rolling reserve respects the cap", () => {
    const c = ctrl("ROLLING_RESERVE", { pctBps: 1000, holdDays: 120, capMinor: "50000" });
    expect(holdForDay(c, 1_000_000n, 45_000n, 0n)).toBe(5_000n);
    expect(holdForDay(c, 1_000_000n, 50_000n, 0n)).toBe(0n);
  });
  it("fixed reserve holds until the target", () => {
    const c = ctrl("FIXED_RESERVE", { targetMinor: "100000", pctUntilTargetBps: 2500 });
    expect(holdForDay(c, 200_000n, 0n, 0n)).toBe(50_000n);
    expect(holdForDay(c, 200_000n, 80_000n, 0n)).toBe(20_000n);
    expect(holdForDay(c, 200_000n, 100_000n, 0n)).toBe(0n);
  });
  it("upfront reserve takes the amount once, across days if needed", () => {
    const c = ctrl("UPFRONT_RESERVE", { amountMinor: "300000" });
    expect(holdForDay(c, 200_000n, 0n, 0n)).toBe(200_000n);
    expect(holdForDay(c, 200_000n, 200_000n, 200_000n)).toBe(100_000n);
    expect(holdForDay(c, 200_000n, 300_000n, 300_000n)).toBe(0n);
  });
  it("no volume, no hold; non-reserve types hold nothing", () => {
    expect(holdForDay(ctrl("ROLLING_RESERVE", { pctBps: 1000, holdDays: 1 }), 0n, 0n, 0n)).toBe(0n);
    expect(holdForDay(ctrl("PAYOUT_DELAY", { days: 7 }), 100n, 0n, 0n)).toBe(0n);
  });
});

describe("schedule helpers", () => {
  it("only rolling reserves release on a schedule", () => {
    expect(isoDay(releaseDateFor(ctrl("ROLLING_RESERVE", { pctBps: 1000, holdDays: 120 }), day0)!)).toBe("2027-03-01");
    expect(releaseDateFor(ctrl("FIXED_RESERVE", {}), day0)).toBeNull();
  });
  it("appliesOn respects effectiveFrom and until", () => {
    const c = ctrl("PAYOUT_DELAY", { days: 3 }, { until: addDays(day0, 2) });
    expect(appliesOn(c, addDays(day0, -1))).toBe(false);
    expect(appliesOn(c, day0)).toBe(true);
    expect(appliesOn(c, addDays(day0, 2))).toBe(true);
    expect(appliesOn(c, addDays(day0, 3))).toBe(false);
  });
  it("isReserve", () => {
    expect(isReserve("ROLLING_RESERVE")).toBe(true);
    expect(isReserve("PAYOUT_HOLD")).toBe(false);
  });
});

describe("exposure", () => {
  it("matches the PRD example: ADV 12,500 USD, 15 days delivery, 120-day window, 1.2% + 1.2%", () => {
    const settled = Array.from({ length: 30 }, () => 1_250_000n);
    const e = computeExposure({
      settled30d: settled,
      expectedMonthlyVolumeMinor: 0n,
      avgDeliveryDays: 15,
      disputeWindowDays: 120,
      cbRatePpm: 12_000,
      refundRatePpm: 12_000,
      reserveBalance: 4_000_000n,
    });
    expect(e.adv).toBe(1_250_000n);
    expect(e.futureDelivery).toBe(18_750_000n);
    expect(e.disputeExposure).toBe(3_600_000n);
    expect(e.totalExposure).toBe(22_350_000n);
    expect(e.coverage).toBeCloseTo(0.179, 3);
    expect(e.formulas.disputeExposure).toBe("ADV × 120 days × (0.012 + 0.012)");
  });
  it("new merchants use declared monthly volume / 30", () => {
    expect(averageDailyVolume([], 3_000_000n)).toEqual({ adv: 100_000n, source: "declared_monthly" });
    expect(averageDailyVolume([1n, 2n], 3_000_000n).source).toBe("declared_monthly");
  });
  it("zero exposure gives coverage 0 or 1", () => {
    const base = { settled30d: [], expectedMonthlyVolumeMinor: 0n, avgDeliveryDays: 0, disputeWindowDays: 120, cbRatePpm: 0, refundRatePpm: 0 };
    expect(computeExposure({ ...base, reserveBalance: 0n }).coverage).toBe(0);
    expect(computeExposure({ ...base, reserveBalance: 5n }).coverage).toBe(1);
  });
});

describe("simulate", () => {
  const flat = [100_000n];
  it("no controls: merchant gets everything T+1, nothing withheld beyond the first-day lag", () => {
    const r = simulate({ start: day0, days: 10, dailySettled: flat, controls: [], opening: {}, pending: [] });
    expect(r.totalHeld).toBe(0n);
    expect(r.endBalance).toBe(0n);
    expect(r.notReceived).toBe(0n);
    expect(r.days[0].payout).toBe(0n);
    expect(r.days[1].payout).toBe(100_000n);
  });
  it("rolling 10% / 5 days builds a balance that plateaus", () => {
    const c = ctrl("ROLLING_RESERVE", { pctBps: 1000, holdDays: 5 });
    const r = simulate({ start: day0, days: 20, dailySettled: flat, controls: [c], opening: {}, pending: [] });
    expect(r.days[0].hold).toBe(10_000n);
    expect(r.days[4].balance).toBe(50_000n);
    expect(r.days[5].release).toBe(10_000n);
    expect(r.days[19].balance).toBe(50_000n);
    expect(r.totalHeld - r.totalReleased).toBe(r.endBalance);
    expect(r.weeks).toHaveLength(3);
    // Withheld inside the window = holds not yet released, less the last day's hold whose
    // payout would itself only land on day 20 (outside the window).
    expect(r.notReceived).toBe(40_000n);
  });
  it("payout delay shifts money, it does not reserve it", () => {
    const c = ctrl("PAYOUT_DELAY", { days: 3 });
    const r = simulate({ start: day0, days: 10, dailySettled: flat, controls: [c], opening: {}, pending: [] });
    expect(r.endBalance).toBe(0n);
    expect(r.days[1].payout).toBe(0n);
    expect(r.days[3].payout).toBe(100_000n);
    expect(r.notReceived).toBe(200_000n);
  });
  it("payout hold freezes payouts and releases until it ends", () => {
    const hold = ctrl("PAYOUT_HOLD", { untilDate: isoDay(addDays(day0, 4)) });
    const roll = ctrl("ROLLING_RESERVE", { pctBps: 1000, holdDays: 2 });
    const r = simulate({ start: day0, days: 8, dailySettled: flat, controls: [hold, roll], opening: {}, pending: [] });
    expect(r.days.slice(0, 4).every((d) => d.payout === 0n)).toBe(true);
    expect(r.days[2].release).toBe(0n);
    expect(r.days[4].payout).toBeGreaterThan(0n);
    expect(r.days[4].release).toBe(30_000n);
  });
  it("existing pending holds release on schedule, overdue ones on day one", () => {
    const r = simulate({
      start: day0,
      days: 5,
      dailySettled: [0n],
      controls: [],
      opening: { old: { balance: 7_000n, heldToDate: 7_000n } },
      pending: [
        { controlId: "old", amountMinor: 3_000n, releaseAt: addDays(day0, -2) },
        { controlId: "old", amountMinor: 4_000n, releaseAt: addDays(day0, 2) },
      ],
    });
    expect(r.days[0].release).toBe(3_000n);
    expect(r.days[2].release).toBe(4_000n);
    expect(r.endBalance).toBe(0n);
  });
  it("stacked reserves apply to what is left after the previous one", () => {
    const a = ctrl("UPFRONT_RESERVE", { amountMinor: "150000" }, { id: "a" });
    const b = ctrl("ROLLING_RESERVE", { pctBps: 1000, holdDays: 100 }, { id: "b" });
    const r = simulate({ start: day0, days: 2, dailySettled: flat, controls: [a, b], opening: {}, pending: [] });
    expect(r.days[0].hold).toBe(100_000n);
    expect(r.days[1].hold).toBe(50_000n + 5_000n);
  });
  it("an empty volume series simulates zeros", () => {
    const r = simulate({ start: day0, days: 3, dailySettled: [], controls: [], opening: {}, pending: [] });
    expect(r.days.every((d) => d.settled === 0n)).toBe(true);
  });
});

describe("controlNeedsApproval (policy v1)", () => {
  const fe = DEFAULT_POLICY.fourEyes;
  it("rolling >= 10% needs approval; below does not", () => {
    expect(controlNeedsApproval("ROLLING_RESERVE", { pctBps: 1000 }, fe).required).toBe(true);
    expect(controlNeedsApproval("ROLLING_RESERVE", { pctBps: 999 }, fe).required).toBe(false);
  });
  it("fixed/upfront >= 50,000 USD", () => {
    expect(controlNeedsApproval("FIXED_RESERVE", { targetMinor: "5000000" }, fe).required).toBe(true);
    expect(controlNeedsApproval("FIXED_RESERVE", { targetMinor: "4999999" }, fe).required).toBe(false);
    expect(controlNeedsApproval("UPFRONT_RESERVE", { amountMinor: "5000000" }, fe).required).toBe(true);
    expect(controlNeedsApproval("UPFRONT_RESERVE", { amountMinor: "100" }, fe).required).toBe(false);
  });
  it("any payout hold; limits never", () => {
    expect(controlNeedsApproval("PAYOUT_HOLD", {}, fe).required).toBe(true);
    expect(controlNeedsApproval("PAYOUT_HOLD", {}, { ...fe, payoutHold: false }).required).toBe(false);
    expect(controlNeedsApproval("VOLUME_LIMIT_DAILY", { limitMinor: "1" }, fe)).toEqual({ required: false, reason: null });
  });
});
