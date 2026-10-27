import type { RiskBand } from "@prisma/client";
import { db } from "@/lib/db";
import { now, simToday } from "@/lib/clock";
import { getActivePolicy, networkLines } from "@/lib/domain/policy";
import { loadDayRows } from "@/lib/domain/metrics";
import { networkFigures, networkHistoryStart, type DayRow, type NetworkFigures } from "@/lib/domain/metrics/context";
import { addDays, computeExposure, isoDay } from "@/lib/domain/reserves/calc";
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
  const yesterday = addDays(today, -1);
  const [agg, reserves, assessments, history] = await Promise.all([
    db.dailyMerchantMetric.groupBy({
      by: ["merchantId"],
      where: { merchantId: { in: ids }, date: { gte: addDays(today, -30), lt: today } },
      _sum: { grossVolumeMinor: true, settledCount: true, chargebackCount: true, refundCount: true },
      _count: true,
    }),
    db.reserveLedgerEntry.groupBy({ by: ["merchantId", "direction"], where: { merchantId: { in: ids } }, _sum: { amountMinor: true } }),
    db.riskAssessment.findMany({ where: { merchantId: { in: ids } }, select: { merchantId: true, band: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
    // Every merchant that ever processed counts towards the portfolio ratio, including closed ones.
    loadDayRows(null, networkHistoryStart(yesterday), yesterday),
  ]);
  const aggBy = new Map(agg.map((a) => [a.merchantId, a]));
  const reserveBy = new Map<string, bigint>();
  for (const r of reserves) reserveBy.set(r.merchantId, (reserveBy.get(r.merchantId) ?? 0n) + (r.direction === "HOLD" ? 1n : -1n) * (r._sum.amountMinor ?? 0n));

  const lines = networkLines(policy.params);
  const date = isoDay(yesterday);
  const bands = BANDS.map((b) => ({ band: b, merchants: 0, volume30: 0n, exposure: 0n, reserve: 0n }));

  // Network programs per merchant, and for the whole portfolio (the sponsor acquirer is assessed
  // on the sum, which is what the payfac is answerable for).
  const portfolioRows = new Map<string, DayRow>();
  const figuresBy = new Map<string, NetworkFigures>();
  for (const [id, rows] of history) {
    figuresBy.set(id, networkFigures(rows, date, lines.countFraudDisputesTwice));
    for (const r of rows) {
      const t = portfolioRows.get(r.date) ?? { date: r.date, gross: 0, settled: 0, attempts: 0, declines: 0, refunds: 0, chargebacks: 0, crossBorderPct: 0, smallAuth: 0, visaCnp: 0, visaDisputes: 0, visaFraud: 0, visaOverlap: 0, mcSettled: 0, mcCb: 0 };
      t.visaCnp! += r.visaCnp ?? 0;
      t.visaDisputes! += r.visaDisputes ?? 0;
      t.visaFraud! += r.visaFraud ?? 0;
      t.visaOverlap! += r.visaOverlap ?? 0;
      t.mcSettled! += r.mcSettled ?? 0;
      t.mcCb! += r.mcCb ?? 0;
      portfolioRows.set(r.date, t);
    }
  }
  const portfolio = networkFigures([...portfolioRows.values()], date, lines.countFraudDisputesTwice);
  const network: { id: string; name: string; band: RiskBand | null; vamp: NetworkFigures["vamp30"]; ecm: NetworkFigures["ecmMonthToDate"]; vampShare: number; ecmShare: number; share: number; contribution: number }[] = [];
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
    // Same count floor as the network rules, so a handful of disputes on a tiny merchant is not listed.
    const f = figuresBy.get(m.id);
    if (f && (f.vamp30.count >= lines.warningMinCount || f.ecmMonthToDate.count >= lines.warningMinCount)) {
      const vampShare = f.vamp30.count >= lines.warningMinCount ? (f.vamp30.ratio ?? 0) / lines.vampLine : 0;
      const ecmShare = f.ecmMonthToDate.count >= lines.warningMinCount ? (f.ecmMonthToDate.ratio ?? 0) / lines.ecmLine : 0;
      network.push({
        id: m.id,
        name: m.dbaName ?? m.legalName,
        band: m.currentBand,
        vamp: f.vamp30,
        ecm: f.ecmMonthToDate,
        vampShare,
        ecmShare,
        share: Math.max(vampShare, ecmShare),
        contribution: portfolio.vamp30.count ? f.vamp30.count / portfolio.vamp30.count : 0,
      });
    }
  }
  network.sort((x, y) => y.share - x.share);
  const contributors = [...network].sort((x, y) => y.contribution - x.contribution).slice(0, 5);

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
    lines,
    portfolioNetwork: portfolio,
    contributors,
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
