import type { PolicyParams } from "@/lib/domain/policy/types";
import { formatMoney } from "@/lib/money";

/**
 * Deterministic, explainable risk score (PRD §6.2).
 * score = sum of weighted factor points, clamped to 0-100. No statistics, no I/O.
 */

export type Band = "LOW" | "MEDIUM" | "HIGH" | "PROHIBITED";

export type FactorResult = {
  key: string;
  label: string;
  input: unknown;
  points: number;
  maxPoints: number;
  explanation: string;
};

export type ScoreResult = {
  score: number;
  band: Band;
  factors: FactorResult[];
  hardStops: { key: string; label: string }[];
  policyVersion: number;
};

export type WebsiteCheck = { live: boolean; refundPolicy: boolean; terms: boolean; contact: boolean };

export type ScoringInput = {
  asOf: Date;
  mcc: string;
  country: string;
  incorporatedAt: Date | null;
  deliveryModel: "IMMEDIATE" | "DIGITAL" | "SHIPPED" | "FUTURE_SERVICE" | "SUBSCRIPTION";
  avgDeliveryDays: number;
  expectedMonthlyVolumeMinor: bigint;
  expectedAvgTicketMinor: bigint;
  currency: string;
  /** Historical chargeback ratio from a prior processor, in basis points; null if none. */
  priorCbRatioBps: number | null;
  /** null when the merchant has no website (card-present only). */
  website: WebsiteCheck | null;
  owners: {
    fullName: string;
    screeningStatus: string;
    hits: { listName: string; status: string }[];
  }[];
  /** Merchant itself appears on the internal terminated list. */
  merchantOnTerminatedList: boolean;
};

export function monthsBetween(from: Date, to: Date): number {
  const months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  return to.getUTCDate() < from.getUTCDate() ? months - 1 : months;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function mccTier(mcc: string, policy: PolicyParams): "standard" | "elevated" | "high" | "prohibited" {
  const t = policy.scoring.mccTiers;
  if (t.prohibited.includes(mcc)) return "prohibited";
  if (t.high.includes(mcc)) return "high";
  if (t.elevated.includes(mcc)) return "elevated";
  return "standard";
}

export function bandFor(score: number, policy: PolicyParams): Exclude<Band, "PROHIBITED"> {
  const { mediumFrom, highFrom } = policy.scoring.bands;
  if (score >= highFrom) return "HIGH";
  if (score >= mediumFrom) return "MEDIUM";
  return "LOW";
}

export function scoreMerchant(input: ScoringInput, policy: PolicyParams, policyVersion: number): ScoreResult {
  const P = policy.scoring.points;
  const factors: FactorResult[] = [];
  const mccName = policy.scoring.mccNames[input.mcc] ?? `MCC ${input.mcc}`;

  // mcc_tier
  {
    const tier = mccTier(input.mcc, policy);
    const points = tier === "high" ? P.mcc.high : tier === "elevated" ? P.mcc.elevated : 0;
    const tierLabel = tier === "prohibited" ? "Prohibited" : tier[0].toUpperCase() + tier.slice(1);
    factors.push({
      key: "mcc_tier",
      label: "Business category",
      input: { mcc: input.mcc, tier },
      points,
      maxPoints: P.mcc.high,
      explanation: `${mccName} (${input.mcc}) is ${tierLabel.toLowerCase()} risk -> +${points}`,
    });
  }

  // business_age
  {
    let points: number;
    let explanation: string;
    if (!input.incorporatedAt) {
      points = P.businessAge.under6m;
      explanation = `No incorporation date on file, treated as under 6 months -> +${points}`;
    } else {
      const m = Math.max(0, monthsBetween(input.incorporatedAt, input.asOf));
      if (m < 6) points = P.businessAge.under6m;
      else if (m <= 24) points = P.businessAge.from6to24m;
      else points = P.businessAge.over24m;
      const band = m < 6 ? "under 6 months" : m <= 24 ? "6-24 months" : "over 24 months";
      explanation = `Business is ${plural(m, "month")} old (${band}) -> +${points}`;
    }
    factors.push({
      key: "business_age",
      label: "Business age",
      input: input.incorporatedAt ? { months: Math.max(0, monthsBetween(input.incorporatedAt, input.asOf)) } : null,
      points,
      maxPoints: P.businessAge.under6m,
      explanation,
    });
  }

  // delivery_model
  {
    const points = P.deliveryModel[input.deliveryModel];
    const words: Record<ScoringInput["deliveryModel"], string> = {
      IMMEDIATE: "Goods handed over at purchase",
      DIGITAL: "Digital delivery",
      SHIPPED: "Physical goods shipped",
      SUBSCRIPTION: "Recurring subscription",
      FUTURE_SERVICE: "Service delivered in the future",
    };
    factors.push({
      key: "delivery_model",
      label: "Delivery model",
      input: input.deliveryModel,
      points,
      maxPoints: Math.max(...Object.values(P.deliveryModel)),
      explanation: `${words[input.deliveryModel]} -> +${points}`,
    });
  }

  // delivery_days
  {
    const d = input.avgDeliveryDays;
    const points = d <= 7 ? P.deliveryDays.upTo7 : d <= 30 ? P.deliveryDays.from8to30 : P.deliveryDays.over30;
    const band = d <= 7 ? "0-7 days" : d <= 30 ? "8-30 days" : "over 30 days";
    factors.push({
      key: "delivery_days",
      label: "Days until delivery",
      input: d,
      points,
      maxPoints: P.deliveryDays.over30,
      explanation: `Customers wait ${plural(d, "day")} on average (${band}) -> +${points}`,
    });
  }

  // ticket_size
  {
    const p90 = BigInt(policy.scoring.ticketP90ByMcc[input.mcc] ?? policy.scoring.defaultTicketP90Minor);
    const over = input.expectedAvgTicketMinor > p90;
    const points = over ? P.ticketAboveP90 : 0;
    factors.push({
      key: "ticket_size",
      label: "Average ticket",
      input: { expectedMinor: input.expectedAvgTicketMinor.toString(), p90Minor: p90.toString() },
      points,
      maxPoints: P.ticketAboveP90,
      explanation: over
        ? `Expected ${formatMoney(input.expectedAvgTicketMinor, input.currency)} is above the category's 90th percentile of ${formatMoney(p90, input.currency)} -> +${points}`
        : `Expected ${formatMoney(input.expectedAvgTicketMinor, input.currency)} is within the category's 90th percentile of ${formatMoney(p90, input.currency)} -> +0`,
    });
  }

  // volume_vs_age
  {
    const cfg = policy.scoring.volumeVsAge;
    const threshold = BigInt(cfg.monthlyVolumeThresholdMinor);
    const ageMonths = input.incorporatedAt ? Math.max(0, monthsBetween(input.incorporatedAt, input.asOf)) : 0;
    const young = ageMonths < cfg.maxAgeMonths;
    const hit = young && input.expectedMonthlyVolumeMinor > threshold;
    const points = hit ? P.volumeVsAge : 0;
    factors.push({
      key: "volume_vs_age",
      label: "Volume for its age",
      input: { ageMonths, expectedMonthlyMinor: input.expectedMonthlyVolumeMinor.toString() },
      points,
      maxPoints: P.volumeVsAge,
      explanation: hit
        ? `${formatMoney(input.expectedMonthlyVolumeMinor, input.currency)} a month expected from a business under ${cfg.maxAgeMonths} months old (limit ${formatMoney(threshold, input.currency)}) -> +${points}`
        : young
          ? `${formatMoney(input.expectedMonthlyVolumeMinor, input.currency)} a month is within ${formatMoney(threshold, input.currency)} for a young business -> +0`
          : `Business is over ${cfg.maxAgeMonths} months old -> +0`,
    });
  }

  // cross_border
  {
    const foreign = !policy.scoring.primaryCountries.includes(input.country);
    const points = foreign ? P.crossBorder : 0;
    factors.push({
      key: "cross_border",
      label: "Country",
      input: input.country,
      points,
      maxPoints: P.crossBorder,
      explanation: foreign
        ? `Registered in ${input.country}, outside the primary region (${policy.scoring.primaryCountries.join(", ")}) -> +${points}`
        : `Registered in ${input.country}, inside the primary region -> +0`,
    });
  }

  // prior_cb_ratio
  {
    const bps = input.priorCbRatioBps;
    const pc = P.priorCb;
    const points = bps === null ? 0 : bps > pc.highBps ? pc.high : bps >= pc.midBps ? pc.mid : 0;
    const pct = (b: number) => `${(b / 100).toFixed(2)}%`;
    factors.push({
      key: "prior_cb_ratio",
      label: "Prior chargeback ratio",
      input: bps,
      points,
      maxPoints: pc.high,
      explanation:
        bps === null
          ? "No prior processing history -> +0"
          : `${pct(bps)} at the previous processor${bps > pc.highBps ? ` (over ${pct(pc.highBps)})` : bps >= pc.midBps ? ` (${pct(pc.midBps)}-${pct(pc.highBps)})` : ""} -> +${points}`,
    });
  }

  // website_gaps
  {
    const w = input.website;
    let missing: string[] = [];
    if (w) {
      if (!w.live) missing = ["site offline", "refund policy", "terms of service"];
      else {
        if (!w.refundPolicy) missing.push("refund policy");
        if (!w.terms) missing.push("terms of service");
        if (!w.contact) missing.push("contact details");
      }
    }
    const points = Math.min(P.websiteGapMax, missing.length * P.websiteGapEach);
    factors.push({
      key: "website_gaps",
      label: "Website",
      input: w,
      points,
      maxPoints: P.websiteGapMax,
      explanation: !w
        ? "No website; card-present only -> +0"
        : missing.length === 0
          ? "Site is live with refund policy, terms and contact details -> +0"
          : `Missing: ${missing.join(", ")} -> +${points}`,
    });
  }

  // screening_potential
  {
    const pending = input.owners.filter(
      (o) => o.screeningStatus === "POTENTIAL_MATCH" || o.hits.some((h) => h.status === "PENDING_REVIEW"),
    );
    const points = pending.length > 0 ? P.screeningPotential : 0;
    factors.push({
      key: "screening_potential",
      label: "Unreviewed screening hits",
      input: pending.map((o) => o.fullName),
      points,
      maxPoints: P.screeningPotential,
      explanation:
        pending.length > 0
          ? `${plural(pending.length, "owner")} with a possible watchlist match not yet reviewed -> +${points}`
          : "No unreviewed watchlist matches -> +0",
    });
  }

  // Hard stops override the arithmetic.
  const hardStops: { key: string; label: string }[] = [];
  if (mccTier(input.mcc, policy) === "prohibited") {
    hardStops.push({ key: "prohibited_mcc", label: `${mccName} (${input.mcc}) is a prohibited category` });
  }
  for (const o of input.owners) {
    const confirmed = o.hits.filter((h) => h.status === "CONFIRMED");
    const onTerminatedList = confirmed.some((h) => h.listName === "TERMINATED_MERCHANT_MOCK");
    const onWatchlist =
      confirmed.some((h) => h.listName !== "TERMINATED_MERCHANT_MOCK") ||
      (o.screeningStatus === "CONFIRMED_MATCH" && confirmed.length === 0);
    if (onWatchlist) hardStops.push({ key: "confirmed_watchlist", label: `${o.fullName} has a confirmed watchlist match` });
    if (onTerminatedList) hardStops.push({ key: "terminated_list_owner", label: `${o.fullName} is on the terminated merchant list` });
  }
  if (input.merchantOnTerminatedList) {
    hardStops.push({ key: "terminated_list_merchant", label: "Merchant is on the terminated merchant list" });
  }

  const raw = factors.reduce((s, f) => s + f.points, 0);
  const score = Math.max(0, Math.min(100, raw));
  const band: Band = hardStops.length > 0 ? "PROHIBITED" : bandFor(score, policy);
  return { score, band, factors, hardStops, policyVersion };
}
