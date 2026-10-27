import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, isoDay, utcDay, DAY_MS } from "@/lib/domain/reserves/calc";
import { rng, hashString } from "./random";
import { storyPattern, STORY_ANCHOR } from "./stories";

/**
 * Transaction simulator (PRD §11). Deterministic per merchant (by registration number) and day,
 * so a seed always produces the same transactions. Normal merchants follow their declared profile with noise; the story merchants
 * follow the scripted patterns in stories.ts.
 */

const BINS = ["414720", "424631", "431940", "453275", "476173", "516732", "521729", "542418", "557039", "601100"];
/** Brand from the BIN's first digit: 4 Visa, 2 or 5 Mastercard, anything else OTHER. */
export const brandOf = (bin: string) => (bin[0] === "4" ? "VISA" : bin[0] === "5" || bin[0] === "2" ? "MASTERCARD" : "OTHER");
const FOREIGN = ["GB", "DE", "FR", "BR", "MX", "NG", "IN", "PH", "CA", "AU"];

type SimMerchant = {
  id: string;
  registrationNo: string;
  country: string;
  currentBand: string | null;
  expectedMonthlyVolumeMinor: bigint;
  expectedAvgTicketMinor: bigint;
  activatedAt: Date | null;
  createdAt: Date;
  website?: string | null;
  deliveryModel?: string;
};

/** A shop with no website that hands goods over on the spot takes cards in person. */
export const takesCardPresent = (m: Pick<SimMerchant, "website" | "deliveryModel">) => !m.website && m.deliveryModel === "IMMEDIATE";

export type MerchantProfile = { cbRate: number; refundRate: number; declineRate: number; crossBorder: number; growthPerDay: number; volumeFactor: number };

export function profileFor(m: SimMerchant): MerchantProfile {
  const r = rng(`profile:${m.registrationNo}`);
  const band = m.currentBand ?? "LOW";
  const cbRange = band === "HIGH" ? [0.003, 0.0065] : band === "MEDIUM" ? [0.002, 0.005] : [0.0005, 0.0025];
  return {
    cbRate: cbRange[0] + r.next() * (cbRange[1] - cbRange[0]),
    refundRate: 0.01 + r.next() * 0.035,
    declineRate: 0.04 + r.next() * 0.05,
    crossBorder: m.country === "US" ? 0.02 + r.next() * 0.1 : 0.55 + r.next() * 0.2,
    // Most merchants hover around their declared volume; a few grow.
    growthPerDay: r.chance(0.08) ? 0.0012 + r.next() * 0.0018 : (r.next() - 0.5) * 0.0006,
    volumeFactor: 0.75 + r.next() * 0.45,
  };
}

const anchorMs = new Date(`${STORY_ANCHOR}T00:00:00Z`).getTime();

type TxnRow = Prisma.TransactionCreateManyInput;
type DisputeRow = Prisma.DisputeCreateManyInput;
type FraudRow = Prisma.FraudReportCreateManyInput;

/** Generate one merchant-day of transactions and the disputes they will produce later. */
export function generateMerchantDay(m: SimMerchant, day: Date, currency = "USD"): { txns: TxnRow[]; disputes: DisputeRow[]; fraudReports: FraudRow[] } {
  const d = utcDay(day);
  const k = Math.round((d.getTime() - anchorMs) / DAY_MS);
  const r = rng(`day:${m.registrationNo}:${isoDay(d)}`);
  const p = profileFor(m);
  const pattern = storyPattern(m.registrationNo, k);
  const since = utcDay(m.activatedAt ?? m.createdAt);
  const ageDays = Math.max(0, Math.round((d.getTime() - since.getTime()) / DAY_MS));
  const ticket = Number(m.expectedAvgTicketMinor);
  const dailyVolume = Number(m.expectedMonthlyVolumeMinor) / 30;
  const weekday = d.getUTCDay();
  const weekFactor = weekday === 0 ? 0.82 : weekday === 6 ? 0.9 : 1.04;
  const growth = pattern ? 1 : Math.max(0.4, 1 + p.growthPerDay * Math.min(ageDays, 240));
  // A young merchant ramps up over its first three weeks.
  const ramp = Math.min(1, 0.35 + ageDays / 30);
  const lambda = (dailyVolume / Math.max(1, ticket)) * (pattern ? 1 : p.volumeFactor) * weekFactor * growth * ramp * (pattern?.countMultiplier ?? 1);
  const count = r.poisson(lambda);
  const txns: TxnRow[] = [];
  const disputes: DisputeRow[] = [];
  const fraudReports: FraudRow[] = [];
  const startMs = d.getTime();
  const cardPresent = takesCardPresent(m);
  // Issuers file a fraud report (TC40/SAFE) for many fraud claims that never become disputes.
  const fraudOnlyRate = pattern?.fraudReportRate ?? p.cbRate * 0.4;

  const push = (amount: number, status: string, idx: number, foreign: boolean) => {
    // Deterministic and collision-free: merchant, day and sequence.
    const id = `t_${m.id}_${isoDay(d).replaceAll("-", "")}_${idx.toString(36)}`;
    const cardCountry = foreign ? r.pick(FOREIGN) : m.country;
    const cardBin = r.pick(BINS);
    txns.push({
      id,
      merchantId: m.id,
      occurredAt: new Date(startMs + Math.floor(r.next() * DAY_MS)),
      amountMinor: BigInt(Math.max(1, Math.round(amount))),
      currency,
      status,
      cardCountry,
      cardBin,
      cardBrand: brandOf(cardBin),
      isCardPresent: cardPresent,
      isCrossBorder: cardCountry !== m.country,
    });
    return { id, brand: brandOf(cardBin) };
  };
  const fraudReport = (txnId: string, brand: string, at: Date) =>
    fraudReports.push({ id: `f_${txnId}`, merchantId: m.id, transactionId: txnId, cardBrand: brand, reportedAt: at });

  for (let i = 0; i < count; i++) {
    const amt = ticket * (pattern?.ticketMultiplier ?? 1) * Math.exp(r.normal(-0.08, 0.4));
    const foreign = r.chance(p.crossBorder);
    if (r.chance(p.declineRate)) {
      push(amt, "DECLINED", i, foreign);
      continue;
    }
    const refunded = r.chance(p.refundRate);
    const { id, brand } = push(amt, refunded ? "REFUNDED" : "SETTLED", i, foreign);
    // Background merchants: each settled sale may turn into a chargeback 12-50 days later.
    if (!pattern?.receivedCbRatio && !refunded && r.chance(p.cbRate)) {
      const at = new Date(startMs + r.int(12, 50) * DAY_MS + r.int(0, DAY_MS - 1));
      const reason = r.pick(["FRAUD", "NOT_RECEIVED", "NOT_AS_DESCRIBED", "PROCESSING", "OTHER"]);
      disputes.push(disputeFor(m.id, id, BigInt(Math.round(amt)), at, reason));
      // Most fraud disputes are preceded by the issuer's fraud report.
      if (reason === "FRAUD" && r.chance(0.8)) fraudReport(id, brand, new Date(at.getTime() - r.int(1, 6) * DAY_MS));
    } else if (!refunded && r.chance(fraudOnlyRate)) {
      fraudReport(id, brand, new Date(startMs + r.int(5, 40) * DAY_MS + r.int(0, DAY_MS - 1)));
    }
  }
  if (pattern?.smallAuths) {
    for (let j = 0; j < pattern.smallAuths.count; j++) {
      const amt = 50 + r.int(0, 149); // $0.50 - $1.99
      push(amt, r.chance(pattern.smallAuths.declineRate) ? "DECLINED" : "SETTLED", count + j, r.chance(0.8));
    }
  }
  return { txns, disputes, fraudReports };
}

function disputeFor(merchantId: string, transactionId: string, amountMinor: bigint, receivedAt: Date, reasonCategory: string): DisputeRow {
  return { id: `d_${transactionId}`, merchantId, transactionId, amountMinor, reasonCategory, receivedAt, status: "OPEN" };
}

/**
 * Story merchants script chargebacks by the day they arrive, so the 30-day ratio follows the
 * story exactly. Sources are settled sales 12-45 days earlier.
 */
async function scriptedDisputes(m: SimMerchant, day: Date, settledToday: number): Promise<DisputeRow[]> {
  const d = utcDay(day);
  const k = Math.round((d.getTime() - anchorMs) / DAY_MS);
  const pattern = storyPattern(m.registrationNo, k);
  if (!pattern?.receivedCbRatio) return [];
  const r = rng(`cb:${m.registrationNo}:${isoDay(d)}`);
  // Expected settled per day is close to today's; use it so the ratio holds on quiet days too.
  const target = Math.round(settledToday * pattern.receivedCbRatio + r.next() - 0.5);
  if (target <= 0) return [];
  const pool = await db.transaction.findMany({
    where: { merchantId: m.id, status: "SETTLED", occurredAt: { gte: addDays(d, -45), lt: addDays(d, -12) } },
    select: { id: true, amountMinor: true },
    orderBy: { occurredAt: "asc" },
    take: target * 6,
  });
  const used = new Set<string>();
  const out: DisputeRow[] = [];
  for (let i = 0; i < target && used.size < pool.length; i++) {
    let t = pool[r.int(0, pool.length - 1)];
    let guard = 0;
    while (used.has(t.id) && guard++ < 20) t = pool[r.int(0, pool.length - 1)];
    if (used.has(t.id)) break;
    used.add(t.id);
    out.push(disputeFor(m.id, t.id, t.amountMinor, new Date(d.getTime() + r.int(0, DAY_MS - 1)), m.registrationNo.includes("NSP") ? "NOT_AS_DESCRIBED" : "NOT_RECEIVED"));
  }
  return out;
}

const PROCESSING = ["ACTIVE", "UNDER_REVIEW", "RESTRICTED"] as const;

/**
 * Simulate one calendar day for every processing merchant: insert transactions, schedule their
 * future disputes, and flip transactions to CHARGEBACK for disputes that arrive today.
 */
export async function simulateDay(day: Date, opts: { merchantIds?: string[] } = {}): Promise<{ transactions: number; disputes: number }> {
  const d = utcDay(day);
  const merchants = await db.merchant.findMany({
    where: { status: { in: [...PROCESSING] }, ...(opts.merchantIds ? { id: { in: opts.merchantIds } } : {}) },
    select: { id: true, registrationNo: true, country: true, currentBand: true, expectedMonthlyVolumeMinor: true, expectedAvgTicketMinor: true, activatedAt: true, createdAt: true, currency: true, website: true, deliveryModel: true },
  });
  let txCount = 0;
  let dsCount = 0;
  let txBatch: TxnRow[] = [];
  let dsBatch: DisputeRow[] = [];
  let frBatch: FraudRow[] = [];
  const flush = async () => {
    if (txBatch.length) await db.transaction.createMany({ data: txBatch, skipDuplicates: true });
    if (dsBatch.length) await db.dispute.createMany({ data: dsBatch, skipDuplicates: true });
    if (frBatch.length) await db.fraudReport.createMany({ data: frBatch, skipDuplicates: true });
    txCount += txBatch.length;
    dsCount += dsBatch.length;
    txBatch = [];
    dsBatch = [];
    frBatch = [];
  };
  for (const m of merchants) {
    if (m.activatedAt && utcDay(m.activatedAt) > d) continue;
    const { txns, disputes, fraudReports } = generateMerchantDay(m, d, m.currency);
    txBatch.push(...txns);
    dsBatch.push(...disputes);
    frBatch.push(...fraudReports);
    if (txBatch.length > 6000) await flush();
  }
  await flush();
  // Scripted chargebacks need today's settled count of the story merchants.
  for (const m of merchants) {
    if (!storyPattern(m.registrationNo, 0)?.receivedCbRatio && !storyPattern(m.registrationNo, -1)?.receivedCbRatio) continue;
    const settled = await db.transaction.count({ where: { merchantId: m.id, occurredAt: { gte: d, lt: addDays(d, 1) }, status: { in: ["SETTLED", "REFUNDED", "CHARGEBACK"] } } });
    const ds = await scriptedDisputes(m, d, settled);
    if (ds.length) {
      await db.dispute.createMany({ data: ds, skipDuplicates: true });
      dsCount += ds.length;
    }
  }
  await receiveDisputes(d);
  await settleOldDisputes(d);
  await flagControlBreaches(d);
  return { transactions: txCount, disputes: dsCount };
}

/** Disputes arriving today mark their transaction as charged back. */
export async function receiveDisputes(day: Date) {
  const d = utcDay(day);
  await db.$executeRaw`
    UPDATE "Transaction" t SET status = 'CHARGEBACK'
    FROM "Dispute" ds
    WHERE ds."transactionId" = t.id AND ds."receivedAt" >= ${isoDay(d)}::date AND ds."receivedAt" < ${isoDay(addDays(d, 1))}::date
      AND t.status <> 'CHARGEBACK'`;
}

/** Disputes older than 45 days get an outcome (deterministic by id). */
async function settleOldDisputes(day: Date) {
  const cutoff = addDays(day, -45);
  const open = await db.dispute.findMany({ where: { status: "OPEN", receivedAt: { lt: cutoff } }, select: { id: true, receivedAt: true, amountMinor: true } });
  // Keyed on the dispute's content, not its id (ids embed the merchant's random id).
  const roll = (x: (typeof open)[number]) => hashString(`${x.receivedAt.toISOString()}:${x.amountMinor}`) % 100;
  const won = open.filter((x) => roll(x) < 35).map((x) => x.id);
  const lost = open.filter((x) => roll(x) >= 35).map((x) => x.id);
  if (won.length) await db.dispute.updateMany({ where: { id: { in: won } }, data: { status: "WON" } });
  if (lost.length) await db.dispute.updateMany({ where: { id: { in: lost } }, data: { status: "LOST" } });
}

/**
 * Volume limits and max-ticket controls (PRD §6.5): transactions above the limit are flagged
 * OVER_LIMIT / OVER_MAX_TICKET and raise an R-LIMIT-BREACH alert.
 */
export async function flagControlBreaches(day: Date) {
  const d = utcDay(day);
  const controls = await db.control.findMany({ where: { status: "ACTIVE", type: { in: ["VOLUME_LIMIT_DAILY", "MAX_TICKET", "VOLUME_LIMIT_MONTHLY"] }, effectiveFrom: { lte: d } } });
  if (!controls.length) return;
  for (const c of controls) {
    const p = c.params as { limitMinor?: string; maxMinor?: string };
    const from = c.type === "VOLUME_LIMIT_MONTHLY" ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)) : d;
    const txns = await db.transaction.findMany({
      where: { merchantId: c.merchantId, occurredAt: { gte: from, lt: addDays(d, 1) }, status: { in: ["SETTLED", "REFUNDED", "CHARGEBACK"] } },
      orderBy: { occurredAt: "asc" },
      select: { id: true, amountMinor: true, occurredAt: true, flags: true },
    });
    const flagged: string[] = [];
    let flag = "OVER_LIMIT";
    if (c.type === "MAX_TICKET") {
      flag = "OVER_MAX_TICKET";
      for (const t of txns) if (t.occurredAt >= d && t.amountMinor > BigInt(p.maxMinor ?? "0")) flagged.push(t.id);
    } else {
      let run = 0n;
      for (const t of txns) {
        run += t.amountMinor;
        if (run > BigInt(p.limitMinor ?? "0") && t.occurredAt >= d) flagged.push(t.id);
      }
    }
    if (!flagged.length) continue;
    await db.$executeRaw`UPDATE "Transaction" SET flags = array_append(flags, ${flag}) WHERE id = ANY(${flagged}) AND NOT (${flag} = ANY(flags))`;
    const { raiseSystemAlert } = await import("@/lib/domain/rules/system");
    await db.$transaction((tx) =>
      raiseSystemAlert(tx, {
        ruleKey: "R-LIMIT-BREACH",
        merchantId: c.merchantId,
        day: d,
        dedupeKey: `R-LIMIT-BREACH:${c.merchantId}:${isoDay(d)}:${c.id}`,
        evidence: { controlId: c.id, controlType: c.type, flagged: flagged.length, flag, limit: p.limitMinor ?? p.maxMinor, date: isoDay(d) },
      }),
    );
  }
}
