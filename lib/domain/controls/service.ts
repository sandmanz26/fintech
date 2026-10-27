import type { Control, Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { record, type Actor, SYSTEM_ACTOR } from "@/lib/domain/audit";
import { can, ForbiddenError } from "@/lib/auth/rbac";
import { getActivePolicy } from "@/lib/domain/policy";
import { now, simToday } from "@/lib/clock";
import { DomainError, NotFoundError, ConflictError } from "@/lib/errors";
import {
  addDays,
  computeExposure,
  controlNeedsApproval,
  holdForDay,
  isReserve,
  isoDay,
  releaseDateFor,
  simulate,
  utcDay,
  type ControlLike,
  type SimulationResult,
} from "@/lib/domain/reserves/calc";
import { transitionMerchantIfAllowed } from "@/lib/domain/merchants/transition";
import { openCaseForMerchant } from "@/lib/domain/cases/service";
import { CreateControlSchema, HEAVY_TYPES, RESERVE_TYPES } from "./schema";
import { merchantFacingControlText, CONTROL_LABEL, controlSummary } from "./text";
import { requestApproval } from "@/lib/domain/approvals/service";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Reserve ledger: balances are always derived from entries, never stored.

export async function reserveBalances(merchantId: string, tx: Tx = db) {
  const rows = await tx.reserveLedgerEntry.groupBy({ by: ["controlId", "direction"], where: { merchantId }, _sum: { amountMinor: true } });
  const per = new Map<string, { balance: bigint; heldToDate: bigint }>();
  for (const r of rows) {
    const s = per.get(r.controlId) ?? { balance: 0n, heldToDate: 0n };
    const amt = r._sum.amountMinor ?? 0n;
    if (r.direction === "HOLD") {
      s.balance += amt;
      s.heldToDate += amt;
    } else s.balance -= amt;
    per.set(r.controlId, s);
  }
  let total = 0n;
  for (const s of per.values()) total += s.balance;
  return { total, perControl: per };
}

export function toControlLike(c: Pick<Control, "id" | "type" | "params" | "effectiveFrom">): ControlLike {
  return { id: c.id, type: c.type, params: c.params as Record<string, unknown>, effectiveFrom: c.effectiveFrom };
}

/** ADV, rates and exposure components for a merchant (PRD §6.5 calculator). */
export async function merchantExposure(merchantId: string, tx: Tx = db) {
  const policy = await getActivePolicy(tx);
  const m = await tx.merchant.findUnique({ where: { id: merchantId } });
  if (!m) throw new NotFoundError("Merchant");
  const today = await simToday(tx);
  const rows = await tx.dailyMerchantMetric.findMany({
    where: { merchantId, date: { gte: addDays(today, -30), lt: today } },
    orderBy: { date: "asc" },
  });
  const settledCount = rows.reduce((a, r) => a + r.settledCount, 0);
  const cb = rows.reduce((a, r) => a + r.chargebackCount, 0);
  const refunds = rows.reduce((a, r) => a + r.refundCount, 0);
  const { total } = await reserveBalances(merchantId, tx);
  // Before history exists, price on the declared/prior chargeback ratio.
  const cbPpm = settledCount > 0 ? Math.round((cb / settledCount) * 1_000_000) : (m.priorCbRatioBps ?? 50) * 100;
  const refundPpm = settledCount > 0 ? Math.round((refunds / settledCount) * 1_000_000) : 10_000;
  const exposure = computeExposure({
    settled30d: rows.map((r) => r.grossVolumeMinor),
    expectedMonthlyVolumeMinor: m.expectedMonthlyVolumeMinor,
    avgDeliveryDays: m.avgDeliveryDays,
    disputeWindowDays: policy.params.disputeWindowDays,
    cbRatePpm: cbPpm,
    refundRatePpm: refundPpm,
    reserveBalance: total,
  });
  return { ...exposure, currency: m.currency, cbRatePpm: cbPpm, refundRatePpm: refundPpm, dailySettled: rows.map((r) => r.grossVolumeMinor) };
}

// ---------------------------------------------------------------------------
// Impact preview (PRD §6.5 key feature)

export type PreviewInput = { merchantId: string; type: string; params: Record<string, unknown>; reasonCode?: string; reviewAt?: string; effectiveFrom?: string };

export async function previewControl(input: PreviewInput) {
  const policy = await getActivePolicy();
  const m = await db.merchant.findUnique({ where: { id: input.merchantId } });
  if (!m) throw new NotFoundError("Merchant");
  const exp = await merchantExposure(input.merchantId);
  const today = await simToday();
  const start = input.effectiveFrom ? utcDay(new Date(input.effectiveFrom)) : today;
  const active = await db.control.findMany({ where: { merchantId: input.merchantId, status: "ACTIVE" } });
  const { perControl } = await reserveBalances(input.merchantId);
  const pending = await db.reserveLedgerEntry.findMany({ where: { merchantId: input.merchantId, direction: "HOLD", releasedAt: null, releaseAt: { not: null } } });
  const opening = Object.fromEntries(perControl.entries());
  // Project the last 30 days of settled volume forward; a new merchant uses declared volume / 30.
  const daily = exp.dailySettled.length >= 7 ? exp.dailySettled : [exp.adv];
  const base = { start, days: 90, dailySettled: daily, opening, pending: pending.map((p) => ({ controlId: p.controlId, amountMinor: p.amountMinor, releaseAt: p.releaseAt })) };
  const existing = active.map(toControlLike);
  const proposed: ControlLike = { id: "__proposed__", type: input.type, params: input.params, effectiveFrom: start };
  const before = simulate({ ...base, controls: existing });
  const after = simulate({ ...base, controls: [...existing, proposed] });
  const reason = input.reasonCode ? await db.reasonCode.findUnique({ where: { code: input.reasonCode } }) : null;
  const approval = controlNeedsApproval(input.type, input.params, policy.params.fourEyes);
  const coverage = (sim: SimulationResult) => (exp.totalExposure === 0n ? 0 : Number((sim.endBalance * 10_000n) / exp.totalExposure) / 10_000);
  return {
    currency: m.currency,
    exposure: exp,
    before: serialiseSim(before),
    after: serialiseSim(after),
    coverageNow: exp.coverage,
    coverageBefore90: coverage(before),
    coverageAfter90: coverage(after),
    needsApproval: approval,
    merchantText: merchantFacingControlText(input.type, input.params, reason?.merchantFacingText ?? "", m.currency, input.reviewAt),
    summary: `${CONTROL_LABEL[input.type] ?? input.type}: ${controlSummary(input.type, input.params, m.currency)}`,
  };
}

function serialiseSim(s: SimulationResult) {
  return {
    days: s.days.map((d) => ({ date: d.date, settled: d.settled.toString(), hold: d.hold.toString(), release: d.release.toString(), balance: d.balance.toString(), payout: d.payout.toString(), baselinePayout: d.baselinePayout.toString() })),
    weeks: s.weeks.map((w) => ({ weekStart: w.weekStart, withheld: w.withheld.toString() })),
    totalHeld: s.totalHeld.toString(),
    totalReleased: s.totalReleased.toString(),
    endBalance: s.endBalance.toString(),
    notReceived: s.notReceived.toString(),
  };
}

// ---------------------------------------------------------------------------
// Create / activate / remove

export type CreateControlInput = z.infer<typeof CreateControlSchema>;

/**
 * Create a control. Below the four-eyes thresholds it is ACTIVE at once; otherwise it is stored
 * PENDING_APPROVAL with an ApprovalRequest, and nothing touches the merchant until approved.
 */
export async function createControl(actor: Actor & { id: string }, raw: unknown, txIn?: Tx) {
  const input = CreateControlSchema.parse(raw);
  const policy = await getActivePolicy(txIn);
  const approval = controlNeedsApproval(input.type, input.params as Record<string, unknown>, policy.params.fourEyes);
  const isRes = (RESERVE_TYPES as readonly string[]).includes(input.type);
  // RBAC per PRD §3.2. Limits and delays: analyst and up, applied at once. Anything over a
  // four-eyes threshold: proposed. A small reserve: applied by senior and up; an analyst's small
  // reserve becomes a request rather than a refusal (DECISIONS.md).
  let needsApproval: boolean;
  if (approval.required) {
    if (!can(actor.role, "control.propose")) throw new ForbiddenError();
    needsApproval = true;
  } else if (isRes) {
    if (can(actor.role, "control.reserve.small")) needsApproval = false;
    else if (can(actor.role, "control.propose")) needsApproval = true;
    else throw new ForbiddenError();
  } else {
    if (!can(actor.role, "control.limit")) throw new ForbiddenError();
    needsApproval = false;
  }

  const run = async (tx: Tx) => {
    const m = await tx.merchant.findUnique({ where: { id: input.merchantId } });
    if (!m) throw new NotFoundError("Merchant");
    if (["DECLINED", "TERMINATED", "CLOSED"].includes(m.status)) throw new ConflictError("Controls cannot be added to a closed merchant.");
    const rc = await tx.reasonCode.findUnique({ where: { code: input.reasonCode } });
    if (!rc || rc.category !== "CONTROL") throw new DomainError("BAD_REASON", "Choose a control reason code.");
    const at = await now(tx);
    const today = await simToday(tx);
    const effectiveFrom = input.effectiveFrom ? utcDay(new Date(input.effectiveFrom)) : today;
    const reviewAt = utcDay(new Date(input.reviewAt));
    if (reviewAt <= today) throw new DomainError("BAD_REVIEW_DATE", "The review date must be in the future.");
    const control = await tx.control.create({
      data: {
        merchantId: input.merchantId,
        type: input.type,
        params: input.params as Prisma.InputJsonValue,
        status: needsApproval ? "PENDING_APPROVAL" : "ACTIVE",
        reasonCode: input.reasonCode,
        note: input.note,
        effectiveFrom,
        reviewAt,
        createdById: actor.id,
        caseId: input.caseId ?? null,
        createdAt: at,
      },
    });
    await record(tx, actor, { action: needsApproval ? "CONTROL_PROPOSED" : "CONTROL_APPLIED", entityType: "Control", entityId: control.id, after: { merchantId: m.id, type: control.type, params: control.params, reasonCode: control.reasonCode, reviewAt } });
    if (input.caseId) {
      await tx.caseEvent.create({
        data: { caseId: input.caseId, actorId: actor.id, type: "CONTROL_PROPOSED", payload: { controlId: control.id, type: control.type, summary: controlSummary(control.type, control.params as Record<string, unknown>, m.currency), needsApproval }, createdAt: at },
      });
    }
    if (needsApproval) {
      const req = await requestApproval(tx, {
        actionType: "APPLY_CONTROL",
        payload: { controlId: control.id, type: control.type, params: control.params, reason: approval.reason ?? "Reserves set by analysts need a second approver" },
        merchantId: m.id,
        caseId: input.caseId ?? null,
        summary: `${CONTROL_LABEL[control.type]} on ${m.dbaName ?? m.legalName}: ${controlSummary(control.type, control.params as Record<string, unknown>, m.currency)}`,
        actor,
      });
      await tx.control.update({ where: { id: control.id }, data: { approvalId: req.id } });
      return { control: { ...control, approvalId: req.id }, approval: req };
    }
    await onControlActivated(tx, control, actor);
    return { control, approval: null };
  };
  return txIn ? run(txIn) : db.$transaction(run, { timeout: 20_000 });
}

/** Side effects of a control going live: merchant status (PRD §7.1). */
export async function onControlActivated(tx: Tx, control: Control, actor: Actor) {
  if ((HEAVY_TYPES as readonly string[]).includes(control.type)) {
    await transitionMerchantIfAllowed(tx, control.merchantId, "RESTRICTED", actor, { trigger: `CONTROL_ACTIVE:${control.id}`, reasonCode: control.reasonCode });
  }
}

export async function activateControl(tx: Tx, controlId: string, actor: Actor) {
  const c = await tx.control.findUnique({ where: { id: controlId } });
  if (!c) throw new NotFoundError("Control");
  if (c.status !== "PENDING_APPROVAL") throw new ConflictError("Only a pending control can be activated.");
  const today = await simToday(tx);
  const effectiveFrom = c.effectiveFrom < today ? today : c.effectiveFrom;
  const updated = await tx.control.update({ where: { id: controlId }, data: { status: "ACTIVE", effectiveFrom } });
  await record(tx, actor, { action: "CONTROL_APPLIED", entityType: "Control", entityId: controlId, before: { status: c.status }, after: { status: "ACTIVE", effectiveFrom } });
  await onControlActivated(tx, updated, actor);
  // An approved merchant waiting on this condition can now go live.
  const { activateIfReady } = await import("@/lib/domain/underwriting/service");
  await activateIfReady(tx, c.merchantId, actor);
  return updated;
}

export async function rejectPendingControl(tx: Tx, controlId: string, actor: Actor) {
  const c = await tx.control.findUnique({ where: { id: controlId } });
  if (!c || c.status !== "PENDING_APPROVAL") return;
  await tx.control.update({ where: { id: controlId }, data: { status: "REMOVED", removedAt: await now(tx) } });
  await record(tx, actor, { action: "CONTROL_REJECTED", entityType: "Control", entityId: controlId, before: { status: c.status }, after: { status: "REMOVED" } });
}

/** Removing a reserve or a payout hold needs four-eyes; a limit or delay comes off directly. */
export async function requestRemoveControl(actor: Actor & { id: string }, controlId: string, reasonCode: string, note: string) {
  const policy = await getActivePolicy();
  return db.$transaction(async (tx) => {
    const c = await tx.control.findUnique({ where: { id: controlId }, include: { merchant: true } });
    if (!c) throw new NotFoundError("Control");
    if (c.status !== "ACTIVE") throw new ConflictError("Only an active control can be removed.");
    if (!note.trim()) throw new DomainError("NOTE_REQUIRED", "Explain why the control is coming off.");
    const isRes = isReserve(c.type);
    const needs = (isRes && policy.params.fourEyes.removeReserve) || (c.type === "PAYOUT_HOLD" && policy.params.fourEyes.payoutHold);
    if (!needs) {
      if (!can(actor.role, "control.limit")) throw new ForbiddenError();
      await executeRemoveControl(tx, controlId, actor, { reasonCode, note });
      return { removed: true, approval: null };
    }
    if (!can(actor.role, "control.propose")) throw new ForbiddenError();
    const existing = await tx.approvalRequest.findFirst({ where: { status: "PENDING", actionType: { in: ["REMOVE_RESERVE", "REMOVE_CONTROL"] }, payload: { path: ["controlId"], equals: controlId } } });
    if (existing) throw new ConflictError("A request to remove this control is already waiting for approval.");
    const { total } = await reserveBalances(c.merchantId, tx);
    const req = await requestApproval(tx, {
      actionType: isRes ? "REMOVE_RESERVE" : "REMOVE_CONTROL",
      payload: { controlId, type: c.type, reasonCode, note },
      merchantId: c.merchantId,
      caseId: c.caseId,
      summary: `Remove ${CONTROL_LABEL[c.type].toLowerCase()} on ${c.merchant.dbaName ?? c.merchant.legalName}${isRes ? `; its reserve balance is released (merchant total ${total.toString()} minor)` : ""}`,
      actor,
    });
    return { removed: false, approval: req };
  });
}

export async function executeRemoveControl(tx: Tx, controlId: string, actor: Actor, why: { reasonCode: string; note: string }) {
  const c = await tx.control.findUnique({ where: { id: controlId }, include: { merchant: true } });
  if (!c) throw new NotFoundError("Control");
  const at = await now(tx);
  await tx.control.update({ where: { id: controlId }, data: { status: "REMOVED", removedAt: at } });
  // A removed reserve gives its remaining balance back to the merchant (unless offboarding holds it).
  if (isReserve(c.type) && !["TERMINATION_PENDING", "TERMINATED", "CLOSED"].includes(c.merchant.status)) {
    const { perControl } = await reserveBalances(c.merchantId, tx);
    const bal = perControl.get(controlId)?.balance ?? 0n;
    if (bal > 0n) {
      const today = await simToday(tx);
      await tx.reserveLedgerEntry.create({
        data: { merchantId: c.merchantId, controlId, direction: "RELEASE", amountMinor: bal, currency: c.merchant.currency, sourceDate: today, createdAt: at },
      });
      await tx.reserveLedgerEntry.updateMany({ where: { controlId, direction: "HOLD", releasedAt: null }, data: { releasedAt: at } });
    }
  }
  await record(tx, actor, { action: "CONTROL_REMOVED", entityType: "Control", entityId: controlId, before: { status: c.status }, after: { status: "REMOVED", ...why } });
  // RESTRICTED -> ACTIVE once no heavy control remains (PRD §7.1).
  const heavyLeft = await tx.control.count({ where: { merchantId: c.merchantId, status: "ACTIVE", type: { in: [...HEAVY_TYPES] } } });
  if (heavyLeft === 0) await transitionMerchantIfAllowed(tx, c.merchantId, "ACTIVE", actor, { trigger: `CONTROL_REMOVED:${controlId}` });
}

// ---------------------------------------------------------------------------
// Daily jobs

/** Hold today's share of settled volume for every active reserve control (idempotent per day). */
export async function applyDailyReserves(day: Date): Promise<number> {
  const d = utcDay(day);
  const controls = await db.control.findMany({
    where: { status: "ACTIVE", type: { in: [...RESERVE_TYPES] }, effectiveFrom: { lte: d } },
    include: { merchant: { select: { currency: true, status: true } } },
  });
  let n = 0;
  for (const c of controls) {
    if (!["ACTIVE", "UNDER_REVIEW", "RESTRICTED"].includes(c.merchant.status)) continue;
    const metric = await db.dailyMerchantMetric.findUnique({ where: { merchantId_date: { merchantId: c.merchantId, date: d } } });
    const settled = metric?.grossVolumeMinor ?? 0n;
    await db.$transaction(async (tx) => {
      const exists = await tx.reserveLedgerEntry.findUnique({ where: { controlId_direction_sourceDate: { controlId: c.id, direction: "HOLD", sourceDate: d } } });
      if (exists) return;
      const { perControl } = await reserveBalances(c.merchantId, tx);
      const s = perControl.get(c.id) ?? { balance: 0n, heldToDate: 0n };
      const h = holdForDay(toControlLike(c), settled, s.balance, s.heldToDate);
      if (h <= 0n) return;
      const releaseAt = releaseDateFor(toControlLike(c), d);
      await tx.reserveLedgerEntry.create({
        data: { merchantId: c.merchantId, controlId: c.id, direction: "HOLD", amountMinor: h, currency: c.merchant.currency, sourceDate: d, releaseAt },
      });
      n++;
    });
  }
  return n;
}

/** Release holds whose releaseAt has come, unless a payout hold is active or the merchant is offboarding. */
export async function releaseDueReserves(day: Date): Promise<number> {
  const d = utcDay(day);
  const due = await db.reserveLedgerEntry.findMany({
    where: { direction: "HOLD", releasedAt: null, releaseAt: { lte: d } },
    include: { merchant: { select: { status: true } } },
  });
  const held = await db.control.findMany({ where: { status: "ACTIVE", type: "PAYOUT_HOLD", effectiveFrom: { lte: d } }, select: { merchantId: true, params: true } });
  const onHold = new Set(
    held.filter((h) => !(h.params as { untilDate?: string }).untilDate || new Date((h.params as { untilDate: string }).untilDate) > d).map((h) => h.merchantId),
  );
  let n = 0;
  for (const e of due) {
    if (onHold.has(e.merchantId)) continue;
    if (["TERMINATION_PENDING", "TERMINATED", "CLOSED"].includes(e.merchant.status)) continue;
    await db.$transaction(async (tx) => {
      // The hold's sourceDate keys the release, so a re-run never releases twice.
      const exists = await tx.reserveLedgerEntry.findUnique({ where: { controlId_direction_sourceDate: { controlId: e.controlId, direction: "RELEASE", sourceDate: e.sourceDate } } });
      if (!exists) {
        await tx.reserveLedgerEntry.create({
          data: { merchantId: e.merchantId, controlId: e.controlId, direction: "RELEASE", amountMinor: e.amountMinor, currency: e.currency, sourceDate: e.sourceDate },
        });
        n++;
      }
      await tx.reserveLedgerEntry.update({ where: { id: e.id }, data: { releasedAt: new Date() } });
    });
  }
  return n;
}

/** Controls whose review date has come open a LOW monitoring case, once (PRD §6.5). */
export async function openControlReviewCases(): Promise<number> {
  const at = await now();
  const due = await db.control.findMany({ where: { status: "ACTIVE", reviewAt: { lte: at }, reviewCaseId: null }, include: { merchant: true } });
  for (const c of due) {
    await db.$transaction(async (tx) => {
      const cs = await openCaseForMerchant(tx, {
        merchantId: c.merchantId,
        type: "MONITORING",
        priority: "LOW",
        title: `Review due: ${CONTROL_LABEL[c.type].toLowerCase()}`,
        payload: { reason: "CONTROL_REVIEW_DUE", controlId: c.id, reviewAt: c.reviewAt.toISOString() },
      });
      await tx.control.update({ where: { id: c.id }, data: { reviewCaseId: cs.id } });
    });
  }
  return due.length;
}

/** Expire time-boxed payout holds (untilDate passed). */
export async function expireControls(day: Date): Promise<number> {
  const d = utcDay(day);
  const holds = await db.control.findMany({ where: { status: "ACTIVE", type: "PAYOUT_HOLD" } });
  let n = 0;
  for (const h of holds) {
    const until = (h.params as { untilDate?: string }).untilDate;
    if (until && utcDay(new Date(until)) <= d) {
      await db.$transaction(async (tx) => {
        await tx.control.update({ where: { id: h.id }, data: { status: "EXPIRED", removedAt: await now(tx) } });
        await record(tx, SYSTEM_ACTOR, { action: "CONTROL_EXPIRED", entityType: "Control", entityId: h.id, before: { status: "ACTIVE" }, after: { status: "EXPIRED", untilDate: until } });
        const heavyLeft = await tx.control.count({ where: { merchantId: h.merchantId, status: "ACTIVE", type: { in: [...HEAVY_TYPES] } } });
        if (heavyLeft === 0) await transitionMerchantIfAllowed(tx, h.merchantId, "ACTIVE", SYSTEM_ACTOR, { trigger: `CONTROL_EXPIRED:${h.id}` });
      });
      n++;
    }
  }
  return n;
}

export { isoDay };
