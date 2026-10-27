import type { RiskBand } from "@prisma/client";
import { db } from "@/lib/db";
import { now, simToday } from "@/lib/clock";
import { getActivePolicy } from "@/lib/domain/policy";
import { addDays, computeExposure } from "@/lib/domain/reserves/calc";
import { OPEN_CASE_STATES } from "@/lib/domain/caseStateMachine";
import { PROCESSING_STATES } from "@/lib/domain/merchantStateMachine";
import { ruleStats } from "@/lib/domain/rules/service";

const BANDS: RiskBand[] = ["LOW", "MEDIUM", "HIGH", "PROHIBITED"];

/** Everything the portfolio dashboard needs (PRD §6.8), computed in bulk. */
export async function portfolioSummary() {
  const [policy, today, at] = await Promise.all([getActivePolicy(), simToday(), now()]);
  const merchants = await db.merchant.findMany({
    where: { status: { in: [...PROCESSING_STATES, "TERMINATION_PENDING"] } },
    select: { id: true, dbaName: true, legalName: true, currentBand: true, currentScore: true, avgDeliveryDays: true, expectedMonthlyVolumeMinor: true, priorCbRatioBps: true, status: true, currency: true },
  });
  const ids = merchants.map((m) => m.id);
  const [agg, reserves, assessments] = await Promise.all([
    db.dailyMerchantMetric.groupBy({
      by: ["merchantId"],
      where: { merchantId: { in: ids }, date: { gte: addDays(today, -30), lt: today } },
      _sum: { grossVolumeMinor: true, settledCount: true, chargebackCount: true, refundCount: true },
      _count: true,
    }),
    db.reserveLedgerEntry.groupBy({ by: ["merchantId", "direction"], where: { merchantId: { in: ids } }, _sum: { amountMinor: true } }),
    db.riskAssessment.findMany({ where: { merchantId: { in: ids } }, select: { merchantId: true, band: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
  ]);
  const aggBy = new Map(agg.map((a) => [a.merchantId, a]));
  const reserveBy = new Map<string, bigint>();
  for (const r of reserves) reserveBy.set(r.merchantId, (reserveBy.get(r.merchantId) ?? 0n) + (r.direction === "HOLD" ? 1n : -1n) * (r._sum.amountMinor ?? 0n));

  const threshold = policy.params.network.cbRatioThresholdBps / 10_000;
  const bands = BANDS.map((b) => ({ band: b, merchants: 0, volume30: 0n, exposure: 0n, reserve: 0n }));
  const network: { id: string; name: string; band: RiskBand | null; ratio: number; chargebacks: number; share: number }[] = [];
  for (const m of merchants) {
    const a = aggBy.get(m.id);
    const settled = a?._sum.settledCount ?? 0;
    const cb = a?._sum.chargebackCount ?? 0;
    const refunds = a?._sum.refundCount ?? 0;
    const vol = a?._sum.grossVolumeMinor ?? 0n;
    const reserve = reserveBy.get(m.id) ?? 0n;
    // Same formula as the merchant calculator. ADV = 30-day sum / 30, so the sum is passed padded
    // to seven entries (the calculator's "has history" test); fewer real days uses declared volume.
    const e = computeExposure({
      settled30d: (a?._count ?? 0) >= 7 ? [vol, 0n, 0n, 0n, 0n, 0n, 0n] : [],
      expectedMonthlyVolumeMinor: m.expectedMonthlyVolumeMinor,
      avgDeliveryDays: m.avgDeliveryDays,
      disputeWindowDays: policy.params.disputeWindowDays,
      cbRatePpm: settled ? Math.round((cb / settled) * 1e6) : (m.priorCbRatioBps ?? 50) * 100,
      refundRatePpm: settled ? Math.round((refunds / settled) * 1e6) : 10_000,
      reserveBalance: reserve,
    });
    const b = bands.find((x) => x.band === (m.currentBand ?? "LOW"))!;
    b.merchants++;
    b.volume30 += vol;
    b.exposure += e.totalExposure;
    b.reserve += reserve;
    const ratio = settled ? cb / settled : 0;
    // Materiality floor of 10 chargebacks, as in R-CB-NETWORK-PROX.
    if (settled && cb >= 10) network.push({ id: m.id, name: m.dbaName ?? m.legalName, band: m.currentBand, ratio, chargebacks: cb, share: ratio / threshold });
  }
  network.sort((x, y) => y.ratio - x.ratio);

  // Band trend: each merchant's band as of 90, 60, 30 days ago and today, from assessment history.
  const points = [90, 60, 30, 0].map((d) => ({ daysAgo: d, date: addDays(today, -d) }));
  const trend = points.map((p) => {
    const counts: Record<string, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, PROHIBITED: 0 };
    const latest = new Map<string, RiskBand>();
    for (const a of assessments) if (a.createdAt <= addDays(p.date, 1)) latest.set(a.merchantId, a.band);
    for (const b of latest.values()) counts[b]++;
    return { ...p, counts };
  });

  const [openCases, controlsDue, stats, rules] = await Promise.all([
    db.case.findMany({ where: { status: { in: OPEN_CASE_STATES }, type: { not: "OFFBOARDING" } }, select: { priority: true, slaDueAt: true, createdAt: true } }),
    db.control.findMany({ where: { status: "ACTIVE", reviewAt: { lte: addDays(today, 14) } }, include: { merchant: { select: { id: true, dbaName: true, legalName: true, currency: true } } }, orderBy: { reviewAt: "asc" } }),
    ruleStats(),
    db.rule.findMany({ select: { key: true, name: true }, orderBy: { key: "asc" } }),
  ]);
  const queue = (["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((p) => {
    const xs = openCases.filter((c) => c.priority === p);
    return {
      priority: p,
      open: xs.length,
      inSla: xs.filter((c) => c.slaDueAt >= at).length,
      avgAgeHours: xs.length ? xs.reduce((s, c) => s + (at.getTime() - c.createdAt.getTime()), 0) / xs.length / 3_600_000 : 0,
    };
  });
  return {
    today,
    currency: "USD",
    threshold,
    networkLabel: policy.params.network.label,
    bands,
    trend,
    network,
    queue,
    controlsDue,
    rules: rules.map((r) => ({ ...r, stats: stats.get(r.key) ?? null })),
    totals: {
      exposure: bands.reduce((s, b) => s + b.exposure, 0n),
      reserve: bands.reduce((s, b) => s + b.reserve, 0n),
      volume30: bands.reduce((s, b) => s + b.volume30, 0n),
      merchants: merchants.length,
    },
  };
}
