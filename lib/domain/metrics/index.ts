import { db, Prisma, type Tx } from "@/lib/db";
import { addDays, isoDay, utcDay } from "@/lib/domain/reserves/calc";
import type { DayRow } from "./context";

/**
 * Aggregate one day of transactions into DailyMerchantMetric (PRD §6.3).
 * Idempotent: re-running a day overwrites that day's rows (unique merchantId+date).
 * Every merchant that is processing gets a row, even with zero activity, so averages
 * divide by the days the merchant actually existed.
 */
export async function computeDailyMetrics(day: Date, smallAuthThresholdMinor: bigint, tx: Tx = db): Promise<number> {
  const d = isoDay(day);
  const next = isoDay(addDays(day, 1));
  const n = await tx.$executeRaw`
    INSERT INTO "DailyMerchantMetric" (
      "id","merchantId","date","grossVolumeMinor","settledCount","authAttempts","declineCount",
      "refundCount","refundVolumeMinor","chargebackCount","chargebackVolumeMinor","avgTicketMinor",
      "crossBorderPct","smallAuthCount",
      "visaCnpSettledCount","visaDisputeCount","visaFraudReportCount","visaFraudOverlapCount","mcSettledCount","mcChargebackCount")
    SELECT gen_random_uuid()::text, m.id, ${d}::date,
      COALESCE(t.gross, 0), COALESCE(t.settled, 0), COALESCE(t.attempts, 0), COALESCE(t.declines, 0),
      COALESCE(t.refunds, 0), COALESCE(t.refund_vol, 0), COALESCE(cb.n, 0), COALESCE(cb.vol, 0),
      CASE WHEN COALESCE(t.settled, 0) = 0 THEN 0 ELSE ROUND(t.gross / t.settled) END,
      CASE WHEN COALESCE(t.settled, 0) = 0 THEN 0 ELSE ROUND(100.0 * t.xb / t.settled, 2) END,
      COALESCE(t.small, 0),
      COALESCE(t.visa_cnp, 0), COALESCE(cb.visa, 0), COALESCE(fr.n, 0), COALESCE(cb.visa_overlap, 0), COALESCE(t.mc, 0), COALESCE(cb.mc, 0)
    FROM "Merchant" m
    LEFT JOIN (
      SELECT "merchantId",
        SUM("amountMinor") FILTER (WHERE status IN ('SETTLED','REFUNDED','CHARGEBACK')) AS gross,
        COUNT(*) FILTER (WHERE status IN ('SETTLED','REFUNDED','CHARGEBACK'))::int AS settled,
        COUNT(*)::int AS attempts,
        COUNT(*) FILTER (WHERE status = 'DECLINED')::int AS declines,
        COUNT(*) FILTER (WHERE status = 'REFUNDED')::int AS refunds,
        COALESCE(SUM("amountMinor") FILTER (WHERE status = 'REFUNDED'), 0) AS refund_vol,
        COUNT(*) FILTER (WHERE "isCrossBorder" AND status IN ('SETTLED','REFUNDED','CHARGEBACK'))::int AS xb,
        COUNT(*) FILTER (WHERE "amountMinor" <= ${smallAuthThresholdMinor})::int AS small,
        COUNT(*) FILTER (WHERE "cardBrand" = 'VISA' AND NOT "isCardPresent" AND status IN ('SETTLED','REFUNDED','CHARGEBACK'))::int AS visa_cnp,
        COUNT(*) FILTER (WHERE "cardBrand" = 'MASTERCARD' AND status IN ('SETTLED','REFUNDED','CHARGEBACK'))::int AS mc
      FROM "Transaction"
      WHERE "occurredAt" >= ${d}::date AND "occurredAt" < ${next}::date
      GROUP BY "merchantId"
    ) t ON t."merchantId" = m.id
    LEFT JOIN (
      -- VAMP counts card-not-present Visa disputes; ECM counts every Mastercard chargeback.
      SELECT ds."merchantId", COUNT(*)::int AS n, SUM(ds."amountMinor") AS vol,
        COUNT(*) FILTER (WHERE tx."cardBrand" = 'VISA' AND NOT tx."isCardPresent")::int AS visa,
        COUNT(*) FILTER (WHERE tx."cardBrand" = 'VISA' AND NOT tx."isCardPresent" AND ds."reasonCategory" = 'FRAUD'
          AND EXISTS (SELECT 1 FROM "FraudReport" f WHERE f."transactionId" = ds."transactionId"))::int AS visa_overlap,
        COUNT(*) FILTER (WHERE tx."cardBrand" = 'MASTERCARD')::int AS mc
      FROM "Dispute" ds JOIN "Transaction" tx ON tx.id = ds."transactionId"
      WHERE ds."receivedAt" >= ${d}::date AND ds."receivedAt" < ${next}::date
      GROUP BY ds."merchantId"
    ) cb ON cb."merchantId" = m.id
    LEFT JOIN (
      SELECT f."merchantId", COUNT(*)::int AS n
      FROM "FraudReport" f JOIN "Transaction" tx ON tx.id = f."transactionId"
      WHERE f."reportedAt" >= ${d}::date AND f."reportedAt" < ${next}::date AND f."cardBrand" = 'VISA' AND NOT tx."isCardPresent"
      GROUP BY f."merchantId"
    ) fr ON fr."merchantId" = m.id
    WHERE m.status IN ('ACTIVE','UNDER_REVIEW','RESTRICTED','TERMINATION_PENDING')
       OR t."merchantId" IS NOT NULL OR cb."merchantId" IS NOT NULL OR fr."merchantId" IS NOT NULL
    ON CONFLICT ("merchantId","date") DO UPDATE SET
      "grossVolumeMinor" = EXCLUDED."grossVolumeMinor",
      "settledCount" = EXCLUDED."settledCount",
      "authAttempts" = EXCLUDED."authAttempts",
      "declineCount" = EXCLUDED."declineCount",
      "refundCount" = EXCLUDED."refundCount",
      "refundVolumeMinor" = EXCLUDED."refundVolumeMinor",
      "chargebackCount" = EXCLUDED."chargebackCount",
      "chargebackVolumeMinor" = EXCLUDED."chargebackVolumeMinor",
      "avgTicketMinor" = EXCLUDED."avgTicketMinor",
      "crossBorderPct" = EXCLUDED."crossBorderPct",
      "smallAuthCount" = EXCLUDED."smallAuthCount",
      "visaCnpSettledCount" = EXCLUDED."visaCnpSettledCount",
      "visaDisputeCount" = EXCLUDED."visaDisputeCount",
      "visaFraudReportCount" = EXCLUDED."visaFraudReportCount",
      "visaFraudOverlapCount" = EXCLUDED."visaFraudOverlapCount",
      "mcSettledCount" = EXCLUDED."mcSettledCount",
      "mcChargebackCount" = EXCLUDED."mcChargebackCount"`;
  return n;
}

type RawMetric = {
  merchantId: string;
  date: Date;
  grossVolumeMinor: bigint;
  settledCount: number;
  authAttempts: number;
  declineCount: number;
  refundCount: number;
  chargebackCount: number;
  crossBorderPct: Prisma.Decimal;
  smallAuthCount: number;
  visaCnpSettledCount: number;
  visaDisputeCount: number;
  visaFraudReportCount: number;
  visaFraudOverlapCount: number;
  mcSettledCount: number;
  mcChargebackCount: number;
};

export function toDayRow(m: RawMetric): DayRow {
  const gross = Number(m.grossVolumeMinor);
  if (!Number.isSafeInteger(gross)) throw new Error("Daily volume exceeds safe integer range");
  return {
    date: isoDay(m.date),
    gross,
    settled: m.settledCount,
    attempts: m.authAttempts,
    declines: m.declineCount,
    refunds: m.refundCount,
    chargebacks: m.chargebackCount,
    crossBorderPct: Number(m.crossBorderPct),
    smallAuth: m.smallAuthCount,
    visaCnp: m.visaCnpSettledCount,
    visaDisputes: m.visaDisputeCount,
    visaFraud: m.visaFraudReportCount,
    visaOverlap: m.visaFraudOverlapCount,
    mcSettled: m.mcSettledCount,
    mcCb: m.mcChargebackCount,
  };
}

/** Metric rows for many merchants over [from, to], grouped by merchant. */
export async function loadDayRows(merchantIds: string[] | null, from: Date, to: Date, tx: Tx = db) {
  const rows = await tx.dailyMerchantMetric.findMany({
    where: { ...(merchantIds ? { merchantId: { in: merchantIds } } : {}), date: { gte: utcDay(from), lte: utcDay(to) } },
    orderBy: { date: "asc" },
  });
  const out = new Map<string, DayRow[]>();
  for (const r of rows) {
    const list = out.get(r.merchantId) ?? [];
    list.push(toDayRow(r));
    out.set(r.merchantId, list);
  }
  return out;
}

/** Last day with any authorisation attempt, per merchant, on or before `to`. */
export async function lastTxnDates(to: Date, tx: Tx = db): Promise<Map<string, string>> {
  const rows = await tx.$queryRaw<{ merchantId: string; d: Date }[]>`
    SELECT "merchantId", MAX("date") AS d FROM "DailyMerchantMetric"
    WHERE "authAttempts" > 0 AND "date" <= ${isoDay(to)}::date
    GROUP BY "merchantId"`;
  return new Map(rows.map((r) => [r.merchantId, isoDay(r.d)]));
}
