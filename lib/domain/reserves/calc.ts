import { divRound, maxBig, minBig, mulBps, ratio } from "@/lib/money";

/**
 * Pure reserve and exposure arithmetic (PRD §6.5). The 90-day impact preview and the
 * daily reserve job both call `holdForDay` / `releaseDateFor`, so a preview and what
 * actually happens use the same code path.
 */

export type ReserveControlType = "ROLLING_RESERVE" | "FIXED_RESERVE" | "UPFRONT_RESERVE";
export type ControlLike = {
  id: string;
  type: string;
  params: Record<string, unknown>;
  effectiveFrom: Date;
  /** Inclusive last day the control applies; null = open-ended. */
  until?: Date | null;
};

export const DAY_MS = 86_400_000;

export function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
export function addDays(d: Date, n: number): Date {
  return new Date(utcDay(d).getTime() + n * DAY_MS);
}
export function isoDay(d: Date): string {
  return utcDay(d).toISOString().slice(0, 10);
}

const big = (v: unknown): bigint => (typeof v === "bigint" ? v : BigInt(String(v ?? "0")));
const int = (v: unknown): number => Number(v ?? 0);

export function isReserve(type: string): type is ReserveControlType {
  return type === "ROLLING_RESERVE" || type === "FIXED_RESERVE" || type === "UPFRONT_RESERVE";
}

export function appliesOn(ctrl: ControlLike, day: Date): boolean {
  const d = utcDay(day).getTime();
  if (d < utcDay(ctrl.effectiveFrom).getTime()) return false;
  if (ctrl.until && d > utcDay(ctrl.until).getTime()) return false;
  return true;
}

/**
 * How much of one day's settled volume this reserve control withholds.
 * @param balance   this control's current reserve balance (holds - releases - losses)
 * @param heldToDate total ever held by this control (for the one-off upfront reserve)
 */
export function holdForDay(ctrl: ControlLike, settledMinor: bigint, balance: bigint, heldToDate: bigint): bigint {
  if (settledMinor <= 0n) return 0n;
  const p = ctrl.params;
  switch (ctrl.type) {
    case "ROLLING_RESERVE": {
      let h = mulBps(settledMinor, int(p.pctBps));
      if (p.capMinor !== undefined && p.capMinor !== null && p.capMinor !== "") {
        h = minBig(h, maxBig(0n, big(p.capMinor) - balance));
      }
      return h;
    }
    case "FIXED_RESERVE": {
      const target = big(p.targetMinor);
      if (balance >= target) return 0n;
      return minBig(mulBps(settledMinor, int(p.pctUntilTargetBps)), target - balance);
    }
    case "UPFRONT_RESERVE": {
      const remaining = maxBig(0n, big(p.amountMinor) - heldToDate);
      return minBig(remaining, settledMinor);
    }
    default:
      return 0n;
  }
}

/** When a hold from `sourceDate` is released. Only rolling reserves release on a schedule. */
export function releaseDateFor(ctrl: ControlLike, sourceDate: Date): Date | null {
  if (ctrl.type === "ROLLING_RESERVE") return addDays(sourceDate, int(ctrl.params.holdDays));
  return null;
}

// ---------------------------------------------------------------------------
// Exposure (PRD §6.5)

export type ExposureInput = {
  /** Settled volume per day for the last 30 days (fewer for a young merchant). */
  settled30d: bigint[];
  expectedMonthlyVolumeMinor: bigint;
  avgDeliveryDays: number;
  disputeWindowDays: number;
  /** Rates as parts per million of settled transactions (12_000 = 1.2%). */
  cbRatePpm: number;
  refundRatePpm: number;
  reserveBalance: bigint;
};

export type Exposure = {
  adv: bigint;
  advSource: "actual_30d" | "declared_monthly";
  futureDelivery: bigint;
  disputeExposure: bigint;
  totalExposure: bigint;
  reserveBalance: bigint;
  coverage: number; // 0..n
  formulas: { futureDelivery: string; disputeExposure: string };
};

export function averageDailyVolume(settled30d: bigint[], expectedMonthlyVolumeMinor: bigint): { adv: bigint; source: Exposure["advSource"] } {
  // A merchant with less than a week of history is priced on what it declared.
  if (settled30d.length < 7) return { adv: divRound(expectedMonthlyVolumeMinor, 30n), source: "declared_monthly" };
  const sum = settled30d.reduce((a, b) => a + b, 0n);
  return { adv: divRound(sum, 30n), source: "actual_30d" };
}

export function computeExposure(i: ExposureInput): Exposure {
  const { adv, source } = averageDailyVolume(i.settled30d, i.expectedMonthlyVolumeMinor);
  const futureDelivery = adv * BigInt(i.avgDeliveryDays);
  const ratePpm = BigInt(Math.round(i.cbRatePpm + i.refundRatePpm));
  const disputeExposure = divRound(adv * BigInt(i.disputeWindowDays) * ratePpm, 1_000_000n);
  const totalExposure = futureDelivery + disputeExposure;
  const pct = (ppm: number) => (ppm / 1_000_000).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return {
    adv,
    advSource: source,
    futureDelivery,
    disputeExposure,
    totalExposure,
    reserveBalance: i.reserveBalance,
    coverage: totalExposure === 0n ? (i.reserveBalance > 0n ? 1 : 0) : ratio(i.reserveBalance, totalExposure),
    formulas: {
      futureDelivery: `ADV × ${i.avgDeliveryDays} days`,
      disputeExposure: `ADV × ${i.disputeWindowDays} days × (${pct(i.cbRatePpm)} + ${pct(i.refundRatePpm)})`,
    },
  };
}

// ---------------------------------------------------------------------------
// 90-day impact simulation

export type PendingHold = { controlId: string; amountMinor: bigint; releaseAt: Date | null };

export type SimulationInput = {
  start: Date; // first simulated day
  days: number;
  /** Settled volume to assume per day; cycled if shorter than `days`. */
  dailySettled: bigint[];
  controls: ControlLike[]; // reserve controls plus PAYOUT_DELAY / PAYOUT_HOLD
  /** Per-control opening balances and held-to-date, from the ledger. */
  opening: Record<string, { balance: bigint; heldToDate: bigint }>;
  /** Existing holds not yet released (from the ledger). */
  pending: PendingHold[];
};

export type SimDay = {
  date: string;
  settled: bigint;
  hold: bigint;
  release: bigint;
  balance: bigint;
  /** What the merchant would have been paid on this day with no controls (T+1). */
  baselinePayout: bigint;
  payout: bigint;
};

export type SimulationResult = {
  days: SimDay[];
  weeks: { weekStart: string; withheld: bigint }[];
  totalHeld: bigint;
  totalReleased: bigint;
  endBalance: bigint;
  /** Baseline minus actual payouts over the horizon: money the merchant did not receive in the window. */
  notReceived: bigint;
};

function activeOfType(controls: ControlLike[], type: string, day: Date) {
  return controls.filter((c) => c.type === type && appliesOn(c, day));
}

function payoutHoldActive(controls: ControlLike[], day: Date): boolean {
  return activeOfType(controls, "PAYOUT_HOLD", day).some((c) => {
    const until = c.params.untilDate ? new Date(String(c.params.untilDate)) : null;
    return !until || utcDay(day).getTime() < utcDay(until).getTime();
  });
}

export function simulate(input: SimulationInput): SimulationResult {
  const reserveControls = input.controls.filter((c) => isReserve(c.type));
  const state = new Map<string, { balance: bigint; heldToDate: bigint }>();
  for (const c of reserveControls) state.set(c.id, { ...(input.opening[c.id] ?? { balance: 0n, heldToDate: 0n }) });
  for (const [id, s] of Object.entries(input.opening)) if (!state.has(id)) state.set(id, { ...s });

  // Release queue keyed by ISO day.
  const releases = new Map<string, { controlId: string; amount: bigint }[]>();
  const queueRelease = (day: Date, controlId: string, amount: bigint) => {
    const k = isoDay(day);
    releases.set(k, [...(releases.get(k) ?? []), { controlId, amount }]);
  };
  for (const p of input.pending) if (p.releaseAt) queueRelease(p.releaseAt, p.controlId, p.amountMinor);

  // Payout schedule: amounts due to the merchant, keyed by the day they are paid.
  const payoutsDue = new Map<string, bigint>();
  const baselineDue = new Map<string, bigint>();
  const addDue = (m: Map<string, bigint>, day: Date, amt: bigint) => m.set(isoDay(day), (m.get(isoDay(day)) ?? 0n) + amt);
  let frozen = 0n; // payouts held back by PAYOUT_HOLD

  const out: SimDay[] = [];
  let totalHeld = 0n;
  let totalReleased = 0n;
  const firstIso = isoDay(input.start);
  const overdueReleases = [...releases.keys()].filter((k) => k < firstIso);
  for (const k of overdueReleases) {
    releases.set(firstIso, [...(releases.get(firstIso) ?? []), ...(releases.get(k) ?? [])]);
    releases.delete(k);
  }

  for (let i = 0; i < input.days; i++) {
    const day = addDays(input.start, i);
    const iso = isoDay(day);
    const settled = input.dailySettled.length ? input.dailySettled[i % input.dailySettled.length] : 0n;
    const hold = payoutHoldActive(input.controls, day);

    // 1. holds on today's settlement
    let heldToday = 0n;
    for (const c of reserveControls) {
      if (!appliesOn(c, day)) continue;
      const s = state.get(c.id)!;
      const h = holdForDay(c, settled - heldToday, s.balance, s.heldToDate);
      if (h > 0n) {
        s.balance += h;
        s.heldToDate += h;
        heldToday += h;
        const r = releaseDateFor(c, day);
        if (r) queueRelease(r, c.id, h);
      }
    }
    totalHeld += heldToday;

    // 2. releases due today (suspended while payouts are on hold)
    let releasedToday = 0n;
    const due = releases.get(iso) ?? [];
    if (hold) {
      if (due.length) {
        const next = isoDay(addDays(day, 1));
        releases.set(next, [...(releases.get(next) ?? []), ...due]);
      }
    } else {
      for (const r of due) {
        const s = state.get(r.controlId);
        if (s) s.balance -= r.amount;
        releasedToday += r.amount;
      }
    }
    releases.delete(iso);
    totalReleased += releasedToday;

    // 3. payouts: net settlement is paid T+delay (default T+1); releases paid the same day
    const delay = Math.max(1, ...activeOfType(input.controls, "PAYOUT_DELAY", day).map((c) => int(c.params.days)));
    addDue(payoutsDue, addDays(day, delay), settled - heldToday);
    addDue(baselineDue, addDays(day, 1), settled);
    let payout = (payoutsDue.get(iso) ?? 0n) + releasedToday;
    payoutsDue.delete(iso);
    if (hold) {
      frozen += payout;
      payout = 0n;
    } else if (frozen > 0n) {
      payout += frozen;
      frozen = 0n;
    }
    const baselinePayout = baselineDue.get(iso) ?? 0n;
    baselineDue.delete(iso);

    let balance = 0n;
    for (const s of state.values()) balance += s.balance;
    out.push({ date: iso, settled, hold: heldToday, release: releasedToday, balance, baselinePayout, payout });
  }

  const weeks: { weekStart: string; withheld: bigint }[] = [];
  for (let i = 0; i < out.length; i += 7) {
    const slice = out.slice(i, i + 7);
    const withheld = slice.reduce((a, d) => a + (d.baselinePayout - d.payout), 0n);
    weeks.push({ weekStart: slice[0].date, withheld });
  }
  const notReceived = out.reduce((a, d) => a + (d.baselinePayout - d.payout), 0n);
  return { days: out, weeks, totalHeld, totalReleased, endBalance: out.at(-1)?.balance ?? 0n, notReceived };
}

/** Does creating/removing this control need a second approver? (PRD §6.5 thresholds) */
export function controlNeedsApproval(
  type: string,
  params: Record<string, unknown>,
  fourEyes: { rollingReservePctBps: number; fixedReserveMinor: string; payoutHold: boolean },
): { required: boolean; reason: string | null } {
  if (type === "ROLLING_RESERVE" && int(params.pctBps) >= fourEyes.rollingReservePctBps) {
    return { required: true, reason: `Rolling reserve of ${int(params.pctBps) / 100}% is at or above ${fourEyes.rollingReservePctBps / 100}%` };
  }
  if (type === "FIXED_RESERVE" && big(params.targetMinor) >= big(fourEyes.fixedReserveMinor)) {
    return { required: true, reason: "Fixed reserve target is at or above the approval threshold" };
  }
  if (type === "UPFRONT_RESERVE" && big(params.amountMinor) >= big(fourEyes.fixedReserveMinor)) {
    return { required: true, reason: "Upfront reserve is at or above the approval threshold" };
  }
  if (type === "PAYOUT_HOLD" && fourEyes.payoutHold) return { required: true, reason: "Every payout hold needs a second approver" };
  return { required: false, reason: null };
}
