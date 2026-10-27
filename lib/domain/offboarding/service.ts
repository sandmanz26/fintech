import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { record, type Actor, SYSTEM_ACTOR } from "@/lib/domain/audit";
import { can, ForbiddenError } from "@/lib/auth/rbac";
import { getActivePolicy } from "@/lib/domain/policy";
import { now, simToday } from "@/lib/clock";
import { ConflictError, DomainError, NotFoundError } from "@/lib/errors";
import { transitionMerchant } from "@/lib/domain/merchants/transition";
import { requestApproval } from "@/lib/domain/approvals/service";
import { openCaseForMerchant } from "@/lib/domain/cases/service";
import { addDays, utcDay } from "@/lib/domain/reserves/calc";
import { minBig } from "@/lib/money";
import { reserveBalances } from "@/lib/domain/controls/service";
import { fmtDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";

/** PRD §6.6 termination categories. */
export const TERMINATION_CATEGORIES = {
  FRAUD: "Fraud",
  EXCESSIVE_CHARGEBACKS: "Excessive chargebacks",
  PRODUCT_POLICY: "Product policy violation",
  COMPLIANCE: "Compliance or sanctions",
  MERCHANT_REQUEST: "Merchant request",
  INACTIVE: "Inactive",
} as const;

export const TerminateSchema = z.object({
  reasonCategory: z.enum(Object.keys(TERMINATION_CATEGORIES) as [keyof typeof TERMINATION_CATEGORIES, ...(keyof typeof TERMINATION_CATEGORIES)[]]),
  reasonCode: z.string().min(1),
  note: z.string().trim().min(3),
  addToTerminatedList: z.boolean().default(false),
  caseId: z.string().optional(),
});
export type TerminatePayload = z.infer<typeof TerminateSchema>;

/** Propose a termination; it only happens once a second, authorised person approves it. */
export async function proposeTermination(actor: Actor & { id: string }, merchantId: string, raw: unknown) {
  if (!can(actor.role, "control.propose") && !can(actor.role, "case.work")) throw new ForbiddenError();
  const input = TerminateSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const m = await tx.merchant.findUnique({ where: { id: merchantId } });
    if (!m) throw new NotFoundError("Merchant");
    if (!["ACTIVE", "UNDER_REVIEW", "RESTRICTED"].includes(m.status)) throw new ConflictError("Only a processing merchant can be terminated.");
    const rc = await tx.reasonCode.findUnique({ where: { code: input.reasonCode } });
    if (!rc || rc.category !== "TERMINATION") throw new DomainError("BAD_REASON", "Choose a termination reason code.");
    const pending = await tx.approvalRequest.findFirst({ where: { merchantId, actionType: "TERMINATE", status: "PENDING" } });
    if (pending) throw new ConflictError("A termination for this merchant is already waiting for approval.");
    const policy = await getActivePolicy(tx);
    const { total } = await reserveBalances(merchantId, tx);
    const name = m.dbaName ?? m.legalName;
    return requestApproval(tx, {
      actionType: "TERMINATE",
      payload: { ...input, merchantId },
      merchantId,
      caseId: input.caseId ?? null,
      summary: `Terminate ${name} (${TERMINATION_CATEGORIES[input.reasonCategory].toLowerCase()}). Processing stops; ${formatMoney(total, m.currency)} reserve held ${policy.params.disputeWindowDays} days for late chargebacks${input.addToTerminatedList ? "; merchant and owners added to the terminated list" : ""}.`,
      actor,
    });
  });
}

/** Runs inside the approval transaction. */
export async function executeTermination(tx: Tx, merchantId: string, p: TerminatePayload, actor: Actor) {
  const m = await tx.merchant.findUnique({ where: { id: merchantId }, include: { owners: true } });
  if (!m) throw new NotFoundError("Merchant");
  const policy = await getActivePolicy(tx);
  const at = await now(tx);
  const today = await simToday(tx);
  // ACTIVE has no direct edge to TERMINATION_PENDING; it passes through UNDER_REVIEW.
  if (m.status === "ACTIVE") await transitionMerchant(tx, merchantId, "UNDER_REVIEW", actor, { trigger: "TERMINATION_APPROVED" });
  await transitionMerchant(tx, merchantId, "TERMINATION_PENDING", actor, { trigger: "TERMINATION_APPROVED", reasonCode: p.reasonCode, note: p.note });
  const windowEnds = addDays(today, policy.params.disputeWindowDays);
  await tx.merchant.update({ where: { id: merchantId }, data: { offboardedAt: at, disputeWindowEndsAt: windowEnds } });
  // Limits and delays stop mattering once processing stops; reserves stay to cover late chargebacks.
  await tx.control.updateMany({ where: { merchantId, status: "ACTIVE", type: { in: ["VOLUME_LIMIT_DAILY", "VOLUME_LIMIT_MONTHLY", "MAX_TICKET", "PAYOUT_DELAY"] } }, data: { status: "EXPIRED", removedAt: at } });

  if (p.addToTerminatedList) {
    await tx.terminatedListEntry.create({ data: { kind: "MERCHANT", name: m.legalName, registrationNo: m.registrationNo, reasonCode: p.reasonCode, merchantId, addedById: actor.id ?? "system" } });
    for (const o of m.owners.filter((o) => Number(o.ownershipPct) >= 25 || o.isController)) {
      await tx.terminatedListEntry.create({ data: { kind: "OWNER", name: o.fullName, reasonCode: p.reasonCode, merchantId, addedById: actor.id ?? "system" } });
    }
    await record(tx, actor, { action: "TERMINATED_LIST_ADDED", entityType: "Merchant", entityId: merchantId, after: { reasonCode: p.reasonCode } });
  }

  const rc = await tx.reasonCode.findUnique({ where: { code: p.reasonCode } });
  const { total } = await reserveBalances(merchantId, tx);
  const notice =
    `${rc?.merchantFacingText ?? "We have closed your account."} ` +
    `Card processing has stopped. We will keep ${formatMoney(total, m.currency)} in reserve until ${fmtDate(windowEnds)} to cover refunds and chargebacks on past sales, then pay out whatever remains.`;
  const off = await openCaseForMerchant(tx, {
    merchantId,
    type: "OFFBOARDING",
    priority: "LOW",
    title: "Offboarding: dispute window and reserve settlement",
    actor,
    payload: { reasonCategory: p.reasonCategory, reasonCode: p.reasonCode, windowEndsAt: windowEnds.toISOString() },
    slaHours: policy.params.disputeWindowDays * 24 + 72,
  });
  await tx.caseEvent.create({ data: { caseId: off.id, actorId: actor.id, type: "NOTE", payload: { body: `Notice sent to merchant: “${notice}”`, merchantNotice: notice }, createdAt: at } });
  await record(tx, actor, { action: "MERCHANT_TERMINATION_STARTED", entityType: "Merchant", entityId: merchantId, after: { windowEndsAt: windowEnds, reserve: total, notice } });
}

/** Voluntary closure: ACTIVE -> CLOSED, still through the dispute window for any reserve. */
export async function closeMerchant(actor: Actor & { id: string }, merchantId: string, note: string) {
  if (!can(actor.role, "case.work")) throw new ForbiddenError();
  return db.$transaction(async (tx) => {
    const policy = await getActivePolicy(tx);
    await transitionMerchant(tx, merchantId, "CLOSED", actor, { trigger: "VOLUNTARY_CLOSURE", note });
    await tx.merchant.update({ where: { id: merchantId }, data: { offboardedAt: await now(tx), disputeWindowEndsAt: addDays(await simToday(tx), policy.params.disputeWindowDays) } });
  });
}

/**
 * When the dispute window ends: apply chargeback losses since offboarding to the reserve,
 * release the rest, and mark the merchant TERMINATED (closed merchants stay CLOSED).
 */
export async function finalizeOffboarding(day: Date): Promise<number> {
  const d = utcDay(day);
  const due = await db.merchant.findMany({ where: { status: { in: ["TERMINATION_PENDING", "CLOSED"] }, disputeWindowEndsAt: { lte: d } } });
  let n = 0;
  for (const m of due) {
    await db.$transaction(async (tx) => {
      const { total, perControl } = await reserveBalances(m.id, tx);
      if (m.status === "CLOSED" && total === 0n) return;
      const losses = await tx.dispute.aggregate({
        where: { merchantId: m.id, receivedAt: { gte: m.offboardedAt ?? d }, status: { in: ["OPEN", "LOST", "ACCEPTED"] } },
        _sum: { amountMinor: true },
        _count: true,
      });
      const loss = losses._sum.amountMinor ?? 0n;
      let toApply = minBig(loss, total);
      let applied = 0n;
      let released = 0n;
      for (const [controlId, s] of perControl) {
        if (s.balance <= 0n) continue;
        const a = minBig(toApply, s.balance);
        if (a > 0n) {
          await tx.reserveLedgerEntry.create({ data: { merchantId: m.id, controlId, direction: "APPLY_TO_LOSS", amountMinor: a, currency: m.currency, sourceDate: d } });
          applied += a;
          toApply -= a;
        }
        const rest = s.balance - a;
        if (rest > 0n) {
          await tx.reserveLedgerEntry.create({ data: { merchantId: m.id, controlId, direction: "RELEASE", amountMinor: rest, currency: m.currency, sourceDate: d } });
          released += rest;
        }
      }
      await tx.reserveLedgerEntry.updateMany({ where: { merchantId: m.id, direction: "HOLD", releasedAt: null }, data: { releasedAt: new Date() } });
      const uncovered = loss - applied;
      const summary = { reserveBefore: total.toString(), losses: loss.toString(), disputes: losses._count, appliedToLoss: applied.toString(), released: released.toString(), uncoveredLoss: uncovered.toString() };
      if (m.status === "TERMINATION_PENDING") {
        await transitionMerchant(tx, m.id, "TERMINATED", SYSTEM_ACTOR, { trigger: "DISPUTE_WINDOW_ENDED", note: JSON.stringify(summary) });
      }
      await record(tx, SYSTEM_ACTOR, { action: "RESERVE_RECONCILED", entityType: "Merchant", entityId: m.id, after: summary });
      const off = await tx.case.findFirst({ where: { merchantId: m.id, type: "OFFBOARDING", status: { not: "RESOLVED" } } });
      if (off) {
        await tx.caseEvent.create({ data: { caseId: off.id, type: "DECISION", payload: { reconciliation: summary, body: "Dispute window ended; reserve reconciled." } } });
        await tx.case.update({ where: { id: off.id }, data: { status: "RESOLVED", resolvedAt: await now(tx), resolutionCode: "CR-TERMINATED", resolutionNote: `Reserve ${summary.reserveBefore} minor; losses ${summary.losses}; released ${summary.released}.` } });
      }
      n++;
    });
  }
  return n;
}
