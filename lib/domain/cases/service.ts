import { randomBytes } from "node:crypto";
import type { CaseStatus, CaseType, Severity, Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { record, type Actor, SYSTEM_ACTOR } from "@/lib/domain/audit";
import { assertCaseTransition, OPEN_CASE_STATES } from "@/lib/domain/caseStateMachine";
import { transitionMerchantIfAllowed } from "@/lib/domain/merchants/transition";
import { getActivePolicy } from "@/lib/domain/policy";
import type { PolicyParams } from "@/lib/domain/policy/types";
import { addBusinessDays, now } from "@/lib/clock";
import { ConflictError, DomainError, NotFoundError } from "@/lib/errors";
import { addDays } from "@/lib/domain/reserves/calc";

export function slaDueFor(priority: Severity, from: Date, policy: PolicyParams, slaHours?: number): Date {
  if (slaHours) return new Date(from.getTime() + slaHours * 3_600_000);
  if (priority === "LOW") return addBusinessDays(from, policy.sla.LOW_BUSINESS_DAYS);
  return new Date(from.getTime() + policy.sla[priority] * 3_600_000);
}

async function event(tx: Tx, caseId: string, actor: Actor, type: string, payload: Record<string, unknown>, at?: Date) {
  await tx.caseEvent.create({ data: { caseId, actorId: actor.id, type, payload: payload as Prisma.InputJsonValue, createdAt: at ?? (await now(tx)) } });
}

/** Open a case; HIGH/CRITICAL cases put an active merchant UNDER_REVIEW (PRD §7.1). */
export async function openCaseForMerchant(
  tx: Tx,
  input: {
    merchantId: string;
    type: CaseType;
    priority: Severity;
    title: string;
    actor?: Actor;
    payload?: Record<string, unknown>;
    slaHours?: number;
    assigneeId?: string | null;
  },
) {
  const actor = input.actor ?? SYSTEM_ACTOR;
  const policy = await getActivePolicy(tx);
  const at = await now(tx);
  const c = await tx.case.create({
    data: {
      merchantId: input.merchantId,
      type: input.type,
      priority: input.priority,
      title: input.title,
      status: input.assigneeId ? "ASSIGNED" : "NEW",
      assigneeId: input.assigneeId ?? null,
      slaDueAt: slaDueFor(input.priority, at, policy.params, input.slaHours),
      createdAt: at,
    },
  });
  await event(tx, c.id, actor, "CREATED", { title: input.title, priority: input.priority, ...(input.payload ?? {}) }, at);
  await record(tx, actor, { action: "CASE_CREATED", entityType: "Case", entityId: c.id, after: { merchantId: c.merchantId, type: c.type, priority: c.priority } });
  if (input.priority === "HIGH" || input.priority === "CRITICAL") {
    await transitionMerchantIfAllowed(tx, input.merchantId, "UNDER_REVIEW", actor, { trigger: `CASE_OPENED:${c.id}` });
  }
  return c;
}

/**
 * Route a new alert (PRD §6.4): link to an open case of the same type for the merchant; reopen a
 * case of the same type resolved in the last 14 days; or open a new case if the rule asks for one.
 */
export async function routeAlert(
  tx: Tx,
  alert: { id: string; merchantId: string; ruleKey: string; severity: Severity },
  autoCase: { enabled: boolean; caseType: CaseType; priority?: Severity; slaHours?: number },
  ruleName: string,
): Promise<string | null> {
  const at = await now(tx);
  const caseType = autoCase.caseType ?? "MONITORING";
  const open = await tx.case.findFirst({
    where: { merchantId: alert.merchantId, type: caseType, status: { in: OPEN_CASE_STATES } },
    orderBy: { createdAt: "desc" },
  });
  if (open) {
    await linkAlert(tx, alert.id, open.id, SYSTEM_ACTOR);
    // A more severe alert raises the case priority (never lowers it).
    const rank = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 } as const;
    if (rank[alert.severity] > rank[open.priority]) {
      const policy = await getActivePolicy(tx);
      const due = slaDueFor(alert.severity, at, policy.params);
      await tx.case.update({ where: { id: open.id }, data: { priority: alert.severity, slaDueAt: due < open.slaDueAt ? due : open.slaDueAt } });
      await event(tx, open.id, SYSTEM_ACTOR, "STATUS_CHANGE", { priority: { from: open.priority, to: alert.severity }, reason: `Alert ${alert.ruleKey}` }, at);
      if (alert.severity === "HIGH" || alert.severity === "CRITICAL") {
        await transitionMerchantIfAllowed(tx, alert.merchantId, "UNDER_REVIEW", SYSTEM_ACTOR, { trigger: `ALERT:${alert.ruleKey}` });
      }
    }
    return open.id;
  }
  const recent = await tx.case.findFirst({
    where: { merchantId: alert.merchantId, type: caseType, status: "RESOLVED", resolvedAt: { gte: addDays(at, -14) } },
    orderBy: { resolvedAt: "desc" },
  });
  if (recent) {
    await tx.case.update({ where: { id: recent.id }, data: { status: "REOPENED", resolvedAt: null } });
    await event(tx, recent.id, SYSTEM_ACTOR, "STATUS_CHANGE", { from: "RESOLVED", to: "REOPENED", reason: `New ${alert.ruleKey} alert within 14 days` }, at);
    await record(tx, SYSTEM_ACTOR, { action: "CASE_REOPENED", entityType: "Case", entityId: recent.id, before: { status: "RESOLVED" }, after: { status: "REOPENED" } });
    await linkAlert(tx, alert.id, recent.id, SYSTEM_ACTOR);
    if (alert.severity === "HIGH" || alert.severity === "CRITICAL") {
      await transitionMerchantIfAllowed(tx, alert.merchantId, "UNDER_REVIEW", SYSTEM_ACTOR, { trigger: `ALERT:${alert.ruleKey}` });
    }
    return recent.id;
  }
  if (!autoCase.enabled) return null;
  const c = await openCaseForMerchant(tx, {
    merchantId: alert.merchantId,
    type: caseType,
    priority: autoCase.priority ?? alert.severity,
    slaHours: autoCase.slaHours,
    title: ruleName,
    payload: { alertId: alert.id, ruleKey: alert.ruleKey },
  });
  await linkAlert(tx, alert.id, c.id, SYSTEM_ACTOR);
  return c.id;
}

export async function linkAlert(tx: Tx, alertId: string, caseId: string, actor: Actor) {
  const a = await tx.alert.findUnique({ where: { id: alertId } });
  if (!a) throw new NotFoundError("Alert");
  const c = await tx.case.findUnique({ where: { id: caseId } });
  if (!c) throw new NotFoundError("Case");
  if (c.merchantId !== a.merchantId) throw new DomainError("MERCHANT_MISMATCH", "An alert can only be linked to a case for the same merchant.");
  if (a.status === "DISMISSED") throw new ConflictError("This alert was dismissed.");
  await tx.alert.update({ where: { id: alertId }, data: { status: "LINKED_TO_CASE", caseId } });
  await event(tx, caseId, actor, "ALERT_LINKED", { alertId, ruleKey: a.ruleKey, severity: a.severity, evidence: a.evidence });
  await record(tx, actor, { action: "ALERT_LINKED", entityType: "Alert", entityId: alertId, before: { status: a.status }, after: { caseId } });
}

export async function linkAlertById(alertId: string, caseId: string, actor: Actor) {
  return db.$transaction((tx) => linkAlert(tx, alertId, caseId, actor));
}

export async function dismissAlert(alertId: string, reasonCode: string, note: string, actor: Actor) {
  return db.$transaction(async (tx) => {
    const a = await tx.alert.findUnique({ where: { id: alertId } });
    if (!a) throw new NotFoundError("Alert");
    if (a.status === "DISMISSED") throw new ConflictError("This alert is already dismissed.");
    const rc = await tx.reasonCode.findUnique({ where: { code: reasonCode } });
    if (!rc || rc.category !== "ALERT_DISMISS" || !rc.active) throw new DomainError("BAD_REASON", "Choose a dismissal reason.");
    await tx.alert.update({ where: { id: alertId }, data: { status: "DISMISSED", dismissReasonCode: reasonCode, dismissNote: note } });
    if (a.caseId) await event(tx, a.caseId, actor, "NOTE", { body: `Dismissed alert ${a.ruleKey}: ${rc.label}. ${note}`, system: true });
    await record(tx, actor, { action: "ALERT_DISMISSED", entityType: "Alert", entityId: alertId, before: { status: a.status }, after: { status: "DISMISSED", reasonCode, note } });
  });
}

export async function assignCase(caseId: string, assigneeId: string, actor: Actor) {
  return db.$transaction(async (tx) => {
    const c = await tx.case.findUnique({ where: { id: caseId } });
    if (!c) throw new NotFoundError("Case");
    const assignee = await tx.user.findUnique({ where: { id: assigneeId } });
    if (!assignee || assignee.role === "MERCHANT" || assignee.role === "AUDITOR" || assignee.role === "ADMIN") {
      throw new DomainError("BAD_ASSIGNEE", "Cases can only be assigned to risk or compliance staff.");
    }
    if (c.status === "RESOLVED") throw new ConflictError("Reopen the case before reassigning it.");
    const to: CaseStatus = c.status === "NEW" ? "ASSIGNED" : c.status;
    if (c.status === "NEW") assertCaseTransition("NEW", "ASSIGNED");
    await tx.case.update({ where: { id: caseId }, data: { assigneeId, status: to } });
    await event(tx, caseId, actor, "ASSIGNED", { from: c.assigneeId, to: assigneeId, toName: assignee.name });
    await record(tx, actor, { action: "CASE_ASSIGNED", entityType: "Case", entityId: caseId, before: { assigneeId: c.assigneeId, status: c.status }, after: { assigneeId, status: to } });
  });
}

/** Generic status change for the case action panel. Resolution needs a code and a note. */
export async function transitionCase(
  caseId: string,
  to: CaseStatus,
  actor: Actor,
  opts: { reasonCode?: string; note?: string } = {},
  txIn?: Tx,
) {
  const run = async (tx: Tx) => {
    const c = await tx.case.findUnique({ where: { id: caseId } });
    if (!c) throw new NotFoundError("Case");
    let from = c.status;
    // "Start review" on an unassigned case assigns it to the person starting it.
    if (to === "IN_REVIEW" && from === "NEW") {
      if (!actor.id) throw new DomainError("NO_ACTOR", "A person must start the review.");
      await tx.case.update({ where: { id: caseId }, data: { status: "ASSIGNED", assigneeId: actor.id } });
      await event(tx, caseId, actor, "ASSIGNED", { from: null, to: actor.id });
      from = "ASSIGNED";
    }
    assertCaseTransition(from, to);
    const at = await now(tx);
    const data: Prisma.CaseUpdateInput = { status: to };
    if (to === "RESOLVED") {
      if (!opts.reasonCode || !opts.note?.trim()) throw new DomainError("RESOLUTION_REQUIRED", "Closing a case needs a resolution code and a note.");
      const rc = await tx.reasonCode.findUnique({ where: { code: opts.reasonCode } });
      if (!rc || rc.category !== "CASE_RESOLUTION") throw new DomainError("BAD_REASON", "Choose a case resolution code.");
      data.resolutionCode = opts.reasonCode;
      data.resolutionNote = opts.note;
      data.resolvedAt = at;
    }
    await tx.case.update({ where: { id: caseId }, data });
    await event(tx, caseId, actor, "STATUS_CHANGE", { from, to, reasonCode: opts.reasonCode ?? null, note: opts.note ?? null }, at);
    await record(tx, actor, { action: "CASE_STATUS_CHANGED", entityType: "Case", entityId: caseId, before: { status: from }, after: { status: to, reasonCode: opts.reasonCode, note: opts.note } });
    if (to === "RESOLVED") await maybeReturnMerchantToActive(tx, c.merchantId, actor, caseId);
  };
  return txIn ? run(txIn) : db.$transaction(run);
}

/** UNDER_REVIEW -> ACTIVE when no HIGH/CRITICAL case is still open and no heavy control is active. */
export async function maybeReturnMerchantToActive(tx: Tx, merchantId: string, actor: Actor, caseId: string) {
  const m = await tx.merchant.findUnique({ where: { id: merchantId }, select: { status: true } });
  if (m?.status !== "UNDER_REVIEW") return;
  const stillOpen = await tx.case.count({
    where: { merchantId, status: { in: OPEN_CASE_STATES }, priority: { in: ["HIGH", "CRITICAL"] } },
  });
  if (stillOpen > 0) return;
  const heavy = await tx.control.count({
    where: { merchantId, status: "ACTIVE", type: { in: ["PAYOUT_HOLD", "ROLLING_RESERVE", "FIXED_RESERVE", "UPFRONT_RESERVE"] } },
  });
  if (heavy > 0) {
    await transitionMerchantIfAllowed(tx, merchantId, "RESTRICTED", actor, { trigger: `CASE_RESOLVED:${caseId}`, note: "Heavy control in force" });
    return;
  }
  await transitionMerchantIfAllowed(tx, merchantId, "ACTIVE", actor, { trigger: `CASE_RESOLVED:${caseId}` });
}

export async function addNote(caseId: string, body: string, actor: Actor) {
  const text = body.trim();
  if (!text) throw new DomainError("EMPTY_NOTE", "Write something before saving the note.");
  return db.$transaction(async (tx) => {
    const c = await tx.case.findUnique({ where: { id: caseId } });
    if (!c) throw new NotFoundError("Case");
    // Mentions: "@Laura" or "@Laura Chen" match a user's first name or full name.
    const users = await tx.user.findMany({ where: { role: { not: "MERCHANT" } }, select: { id: true, name: true } });
    const mentioned = users.filter((u) => {
      const first = u.name.split(" ")[0];
      return new RegExp(`@(${escapeRe(u.name)}|${escapeRe(first)})\\b`, "i").test(text);
    });
    await event(tx, caseId, actor, "NOTE", { body: text, mentions: mentioned.map((u) => u.id) });
    for (const u of mentioned) {
      if (u.id === actor.id) continue;
      await tx.notification.create({ data: { userId: u.id, kind: "MENTION", title: `You were mentioned on a case`, href: `/cases/${caseId}` } });
    }
    await record(tx, actor, { action: "CASE_NOTE_ADDED", entityType: "Case", entityId: caseId, after: { length: text.length, mentions: mentioned.map((u) => u.id) } });
  });
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// RFI

export type RfiItemInput = { key: string; label: string; docType: string; required: boolean };

export function newRfiToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function sendRfi(
  caseId: string,
  input: { items: RfiItemInput[]; message: string; dueAt: Date },
  actor: Actor,
  txIn?: Tx,
) {
  const run = async (tx: Tx) => {
    const c = await tx.case.findUnique({ where: { id: caseId } });
    if (!c) throw new NotFoundError("Case");
    if (input.items.length === 0) throw new DomainError("NO_ITEMS", "Ask for at least one document.");
    const policy = await getActivePolicy(tx);
    let from = c.status;
    if (from === "NEW" || from === "ASSIGNED" || from === "REOPENED") {
      // Sending an RFI implies the review has started.
      if (from === "NEW") {
        await tx.case.update({ where: { id: caseId }, data: { status: "ASSIGNED", assigneeId: c.assigneeId ?? actor.id } });
        from = "ASSIGNED";
      }
      assertCaseTransition(from, "IN_REVIEW");
      from = "IN_REVIEW";
    }
    assertCaseTransition(from, "AWAITING_MERCHANT");
    const token = newRfiToken();
    const rfi = await tx.rfi.create({
      data: {
        merchantId: c.merchantId,
        caseId,
        token,
        items: input.items.map((i) => ({ ...i, status: "REQUESTED" })) as never,
        messageToMerchant: input.message,
        dueAt: input.dueAt,
        expiresAt: addDays(input.dueAt, policy.params.rfiTokenGraceDays),
        createdAt: await now(tx),
      },
    });
    await tx.case.update({ where: { id: caseId }, data: { status: "AWAITING_MERCHANT" } });
    await event(tx, caseId, actor, "RFI_SENT", { rfiId: rfi.id, items: input.items.map((i) => i.label), dueAt: input.dueAt.toISOString() });
    await record(tx, actor, { action: "RFI_SENT", entityType: "Rfi", entityId: rfi.id, after: { caseId, items: input.items.length, dueAt: input.dueAt } });
    await transitionMerchantIfAllowed(tx, c.merchantId, "PENDING_INFO", actor, { trigger: `RFI_SENT:${rfi.id}` });
    return rfi;
  };
  return txIn ? run(txIn) : db.$transaction(run);
}

/** Merchant answered every required item, or the deadline passed: the case goes back to review. */
export async function closeRfi(tx: Tx, rfiId: string, outcome: "ANSWERED" | "OVERDUE") {
  const rfi = await tx.rfi.findUnique({ where: { id: rfiId } });
  if (!rfi) throw new NotFoundError("RFI");
  const at = await now(tx);
  await tx.rfi.update({ where: { id: rfiId }, data: { status: outcome, revokedAt: outcome === "ANSWERED" ? at : rfi.revokedAt } });
  const c = await tx.case.findUnique({ where: { id: rfi.caseId } });
  if (c?.status === "AWAITING_MERCHANT") {
    await tx.case.update({ where: { id: c.id }, data: { status: "IN_REVIEW" } });
    await event(tx, c.id, SYSTEM_ACTOR, outcome === "ANSWERED" ? "RFI_ANSWERED" : "STATUS_CHANGE", {
      rfiId,
      from: "AWAITING_MERCHANT",
      to: "IN_REVIEW",
      reason: outcome === "ANSWERED" ? "Merchant sent everything requested" : "RFI deadline passed",
    }, at);
    if (c.assigneeId) {
      await tx.notification.create({
        data: { userId: c.assigneeId, kind: "RFI", title: outcome === "ANSWERED" ? "A merchant answered your request" : "An RFI deadline passed", href: `/cases/${c.id}` },
      });
    }
  }
  await record(tx, SYSTEM_ACTOR, { action: outcome === "ANSWERED" ? "RFI_ANSWERED" : "RFI_OVERDUE", entityType: "Rfi", entityId: rfiId, before: { status: rfi.status }, after: { status: outcome } });
  await transitionMerchantIfAllowed(tx, rfi.merchantId, "IN_UNDERWRITING", SYSTEM_ACTOR, { trigger: `RFI_${outcome}:${rfiId}` });
}

// ---------------------------------------------------------------------------
// SLA checker (every 15 minutes)

export async function runSlaChecker(): Promise<{ breached: number; overdueRfis: number }> {
  const at = await now();
  const breaching = await db.case.findMany({
    where: { status: { in: OPEN_CASE_STATES }, slaDueAt: { lt: at }, slaBreachedAt: null },
    include: { merchant: { select: { legalName: true, dbaName: true } } },
  });
  for (const c of breaching) {
    await db.$transaction(async (tx) => {
      await tx.case.update({ where: { id: c.id }, data: { slaBreachedAt: at } });
      const name = c.merchant.dbaName ?? c.merchant.legalName;
      await tx.notification.upsert({
        where: { dedupeKey: `SLA:${c.id}` },
        create: { dedupeKey: `SLA:${c.id}`, userId: c.assigneeId, role: c.assigneeId ? null : "RISK_MANAGER", kind: "SLA_BREACH", title: `SLA breached: ${name}`, href: `/cases/${c.id}` },
        update: {},
      });
      await record(tx, SYSTEM_ACTOR, { action: "CASE_SLA_BREACHED", entityType: "Case", entityId: c.id, after: { slaDueAt: c.slaDueAt } });
    });
  }
  const overdue = await db.rfi.findMany({ where: { status: { in: ["SENT", "PARTIALLY_ANSWERED"] }, dueAt: { lt: at } } });
  for (const r of overdue) await db.$transaction((tx) => closeRfi(tx, r.id, "OVERDUE"));
  return { breached: breaching.length, overdueRfis: overdue.length };
}
