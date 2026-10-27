import type { RiskBand } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { record, type Actor, SYSTEM_ACTOR } from "@/lib/domain/audit";
import { getActivePolicy } from "@/lib/domain/policy";
import { scoreMerchant, type ScoringInput, type WebsiteCheck, type ScoreResult } from "./index";
import { NotFoundError } from "@/lib/errors";
import { now } from "@/lib/clock";
import { PROCESSING_STATES } from "@/lib/domain/merchantStateMachine";

export type RescoreTrigger = "ONBOARDING" | "PERIODIC" | "EVENT" | "MANUAL";

/** Gather the scoring inputs for a merchant from the database. */
export async function loadScoringInput(tx: Tx, merchantId: string, asOf: Date): Promise<ScoringInput> {
  const m = await tx.merchant.findUnique({
    where: { id: merchantId },
    include: { owners: { include: { hits: true } }, applications: { orderBy: { submittedAt: "desc" }, take: 1 } },
  });
  if (!m) throw new NotFoundError("Merchant");
  const checks = (m.applications[0]?.checks ?? null) as { website?: WebsiteCheck } | null;
  const website: WebsiteCheck | null = m.website
    ? checks?.website
      ? { live: checks.website.live, refundPolicy: checks.website.refundPolicy, terms: checks.website.terms, contact: checks.website.contact }
      : { live: true, refundPolicy: true, terms: true, contact: true }
    : null;
  const onList = await tx.terminatedListEntry.findFirst({
    where: { kind: "MERCHANT", OR: [{ registrationNo: m.registrationNo }, { merchantId: m.id }] },
  });
  return {
    asOf,
    mcc: m.mcc,
    country: m.country,
    incorporatedAt: m.incorporatedAt,
    deliveryModel: m.deliveryModel,
    avgDeliveryDays: m.avgDeliveryDays,
    expectedMonthlyVolumeMinor: m.expectedMonthlyVolumeMinor,
    expectedAvgTicketMinor: m.expectedAvgTicketMinor,
    currency: m.currency,
    priorCbRatioBps: m.priorCbRatioBps,
    website,
    owners: m.owners.map((o) => ({ fullName: o.fullName, screeningStatus: o.screeningStatus, hits: o.hits.map((h) => ({ listName: h.listName, status: h.status })) })),
    merchantOnTerminatedList: !!onList,
  };
}

function addMonths(d: Date, n: number) {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
}

/**
 * Score a merchant with the active policy, store the assessment (with its factor breakdown and
 * policy version) and update the merchant. A band change writes a case event; a move up to HIGH
 * on a processing merchant opens a MONITORING case.
 */
export async function rescoreMerchant(
  merchantId: string,
  trigger: RescoreTrigger,
  actor: Actor = SYSTEM_ACTOR,
  tx?: Tx,
): Promise<ScoreResult & { previousBand: RiskBand | null }> {
  const run = async (t: Tx) => {
    const at = await now(t);
    const policy = await getActivePolicy(t);
    const input = await loadScoringInput(t, merchantId, at);
    const result = scoreMerchant(input, policy.params, policy.version);
    const before = await t.merchant.findUniqueOrThrow({ where: { id: merchantId }, select: { currentBand: true, currentScore: true, status: true } });
    await t.riskAssessment.create({
      data: {
        merchantId,
        policyVersion: result.policyVersion,
        score: result.score,
        band: result.band,
        factors: result.factors as never,
        hardStops: result.hardStops as never,
        trigger,
        createdById: actor.id,
        createdAt: at,
      },
    });
    const months = result.band === "PROHIBITED" ? 1 : policy.params.rescoreMonths[result.band];
    await t.merchant.update({
      where: { id: merchantId },
      data: { currentBand: result.band, currentScore: result.score, nextReviewAt: addMonths(at, months) },
    });
    await record(t, actor, {
      action: "MERCHANT_RESCORED",
      entityType: "Merchant",
      entityId: merchantId,
      before: { band: before.currentBand, score: before.currentScore },
      after: { band: result.band, score: result.score, policyVersion: result.policyVersion, trigger },
    });

    if (before.currentBand && before.currentBand !== result.band) {
      const openCase = await t.case.findFirst({
        where: { merchantId, status: { notIn: ["RESOLVED"] } },
        orderBy: { createdAt: "desc" },
      });
      const rank = { LOW: 0, MEDIUM: 1, HIGH: 2, PROHIBITED: 3 } as const;
      const movedUpToHigh = rank[result.band] >= 2 && rank[before.currentBand] < 2;
      // One open case per merchant is enough to carry the news; only open a new one if none is open.
      if (movedUpToHigh && !openCase && PROCESSING_STATES.includes(before.status)) {
        const { openCaseForMerchant } = await import("@/lib/domain/cases/service");
        await openCaseForMerchant(t, {
          merchantId,
          type: "MONITORING",
          priority: "HIGH",
          title: `Risk band moved from ${before.currentBand.toLowerCase()} to ${result.band.toLowerCase()}`,
          actor,
          payload: { reason: "BAND_CHANGE", from: before.currentBand, to: result.band, score: result.score },
        });
      } else if (openCase) {
        await t.caseEvent.create({
          data: {
            caseId: openCase.id,
            actorId: actor.id,
            type: "BAND_CHANGE",
            payload: { from: before.currentBand, to: result.band, score: result.score, trigger },
            createdAt: at,
          },
        });
      }
    }
    return { ...result, previousBand: before.currentBand };
  };
  return tx ? run(tx) : db.$transaction(run, { timeout: 20_000 });
}

/** Periodic re-scoring: every merchant whose nextReviewAt has passed (HIGH monthly, MEDIUM quarterly, LOW yearly). */
export async function runPeriodicRescoring(): Promise<number> {
  const at = await now();
  const due = await db.merchant.findMany({
    where: { nextReviewAt: { lte: at }, status: { in: PROCESSING_STATES } },
    select: { id: true },
  });
  for (const m of due) await rescoreMerchant(m.id, "PERIODIC");
  return due.length;
}
