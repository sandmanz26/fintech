import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { advanceSimDay, simToday, invalidateClock } from "@/lib/clock";
import { getActivePolicy } from "@/lib/domain/policy";
import { computeDailyMetrics } from "@/lib/domain/metrics";
import { runMonitoringRules } from "@/lib/domain/rules/service";
import { applyDailyReserves, releaseDueReserves, expireControls, openControlReviewCases } from "@/lib/domain/controls/service";
import { runSlaChecker } from "@/lib/domain/cases/service";
import { activateApprovedMerchants } from "@/lib/domain/underwriting/service";
import { runPeriodicRescoring } from "@/lib/domain/scoring/service";
import { finalizeOffboarding } from "@/lib/domain/offboarding/service";
import { simulateDay } from "@/lib/sim/simulator";
import { rescreenOwners } from "@/lib/domain/screening/service";
import { monitorWebsites } from "@/lib/domain/monitoring/website";
import { isoDay } from "@/lib/domain/reserves/calc";

/** Run a job and record its duration and item count (PRD §10 observability). */
export async function withJobRun<T>(name: string, fn: () => Promise<T>, count?: (r: T) => number): Promise<T> {
  const run = await db.jobRun.create({ data: { name } });
  const t0 = Date.now();
  try {
    const result = await fn();
    const items = count ? count(result) : typeof result === "number" ? result : null;
    await db.jobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), durationMs: Date.now() - t0, items, meta: (typeof result === "object" ? (result as object) : undefined) as never } });
    logger.info({ job: name, ms: Date.now() - t0, items }, "job finished");
    return result;
  } catch (e) {
    await db.jobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), durationMs: Date.now() - t0, ok: false, error: String(e) } });
    logger.error({ job: name, err: e }, "job failed");
    throw e;
  }
}

/** End-of-day pipeline for `day` (PRD §6.3): metrics, then rules, then reserves. Idempotent. */
export async function closeDay(day: Date) {
  const policy = await getActivePolicy();
  await withJobRun("compute-daily-metrics", () => computeDailyMetrics(day, BigInt(policy.params.smallAuthThresholdMinor)));
  await withJobRun("run-monitoring-rules", () => runMonitoringRules(day), (r) => r.alerts);
  await withJobRun("apply-reserves", () => applyDailyReserves(day));
}

/** Morning jobs on the new day: releases, expiries, reviews, activations, screening, websites, re-scoring, SLA. */
export async function openDay(day: Date) {
  await withJobRun("release-reserves", () => releaseDueReserves(day));
  await withJobRun("expire-controls", () => expireControls(day));
  await withJobRun("control-review-cases", () => openControlReviewCases());
  await withJobRun("activate-approved", () => activateApprovedMerchants());
  await withJobRun("rescreen-owners", () => rescreenOwners(day), (r) => r.screened);
  await withJobRun("monitor-websites", () => monitorWebsites(day), (r) => r.scanned);
  await withJobRun("periodic-rescoring", () => runPeriodicRescoring());
  await withJobRun("finalize-offboarding", () => finalizeOffboarding(day));
  await withJobRun("sla-checker", () => runSlaChecker(), (r) => r.breached);
}

/** Demo: simulate today's trading, close the day, move the calendar on, open the next day. */
export async function advanceOneDay() {
  invalidateClock();
  const today = await simToday();
  await withJobRun("simulate-transactions", () => simulateDay(today), (r) => r.transactions);
  await closeDay(today);
  const next = await advanceSimDay();
  await openDay(next);
  return { closed: isoDay(today), today: isoDay(next) };
}
