import type { Prisma, RiskBand } from "@prisma/client";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { record, type Actor, SYSTEM_ACTOR } from "@/lib/domain/audit";
import { adapters } from "@/lib/adapters";
import { can, canDecideBand, ForbiddenError } from "@/lib/auth/rbac";
import { now, simToday } from "@/lib/clock";
import { ConflictError, DomainError, NotFoundError } from "@/lib/errors";
import { transitionMerchant, transitionMerchantIfAllowed } from "@/lib/domain/merchants/transition";
import { rescoreMerchant } from "@/lib/domain/scoring/service";
import { openCaseForMerchant, sendRfi, transitionCase } from "@/lib/domain/cases/service";
import { createControl } from "@/lib/domain/controls/service";
import { requestApproval } from "@/lib/domain/approvals/service";
import { ControlParamsSchema } from "@/lib/domain/controls/schema";
import { buildChecklist, missingItems, type Checklist, type ChecklistStatus } from "./checklist";
import { utcDay } from "@/lib/domain/reserves/calc";
import { OPEN_CASE_STATES } from "@/lib/domain/caseStateMachine";

const PRIORITY_BY_BAND = { LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH", PROHIBITED: "HIGH" } as const;

function uboComplete(owners: { ownershipPct: Prisma.Decimal; isController: boolean }[]) {
  const pct = owners.reduce((a, o) => a + Number(o.ownershipPct), 0);
  return { ok: pct >= 75 || owners.some((o) => o.isController), pct };
}

/** Automatic checklist evidence derived from adapter results and data. */
async function autoChecklist(tx: Tx, merchantId: string) {
  const m = await tx.merchant.findUniqueOrThrow({ where: { id: merchantId }, include: { owners: { include: { hits: true } }, applications: { orderBy: { submittedAt: "desc" }, take: 1 } } });
  const checks = (m.applications[0]?.checks ?? {}) as { kyb?: { matched: boolean; notes: string[] }; website?: { live: boolean; refundPolicy: boolean; terms: boolean; contact: boolean } };
  const ubo = uboComplete(m.owners);
  const pendingHits = m.owners.flatMap((o) => o.hits.filter((h) => h.status === "PENDING_REVIEW").map((h) => `${o.fullName} ~ ${h.matchedName} (${h.matchScore})`));
  const confirmed = m.owners.flatMap((o) => o.hits.filter((h) => h.status === "CONFIRMED").map(() => o.fullName));
  const auto: Partial<Record<string, { status: ChecklistStatus; evidence: string }>> = {
    ubo_complete: ubo.ok
      ? { status: "PASS", evidence: `Owners on file hold ${ubo.pct.toFixed(0)}%${m.owners.some((o) => o.isController) ? "; controller named" : ""}` }
      : { status: "FAIL", evidence: `Owners on file hold ${ubo.pct.toFixed(0)}% and no controller is named` },
    screening_clear:
      confirmed.length > 0
        ? { status: "FAIL", evidence: `Confirmed match: ${confirmed.join(", ")}` }
        : pendingHits.length > 0
          ? { status: "PENDING", evidence: `To review: ${pendingHits.join("; ")}` }
          : { status: "PASS", evidence: `${m.owners.length} owners screened, no matches` },
  };
  if (checks.kyb) {
    auto.kyb_registry = checks.kyb.matched
      ? { status: "PASS", evidence: "Registry record matches name and number" }
      : { status: "FAIL", evidence: checks.kyb.notes.join(" ") || "No registry match" };
  }
  if (checks.website && m.website) {
    const w = checks.website;
    const missing = [!w.live && "site offline", w.live && !w.refundPolicy && "refund policy", w.live && !w.terms && "terms", w.live && !w.contact && "contact details"].filter(Boolean);
    auto.website_policies = missing.length === 0 ? { status: "PASS", evidence: "Live, with refund policy, terms and contact details" } : { status: "FAIL", evidence: `Missing: ${missing.join(", ")}` };
  }
  return { auto, online: !!m.website };
}

export async function refreshChecklist(tx: Tx, applicationId: string, band: RiskBand | null) {
  const app = await tx.application.findUniqueOrThrow({ where: { id: applicationId } });
  const { auto, online } = await autoChecklist(tx, app.merchantId);
  const next = buildChecklist(app.checklist as unknown as Checklist, band, online, auto);
  await tx.application.update({ where: { id: applicationId }, data: { checklist: next as never } });
  return next;
}

/**
 * SUBMITTED -> automatic checks (registry, website, screening of every owner) -> score -> route.
 * In production this runs as a pg-boss job; the seed and the demo call it directly.
 */
export async function runSubmissionChecks(merchantId: string) {
  const m = await db.merchant.findUnique({ where: { id: merchantId }, include: { owners: true, applications: { orderBy: { submittedAt: "desc" }, take: 1 } } });
  if (!m) throw new NotFoundError("Merchant");
  const app = m.applications[0];
  if (!app) throw new NotFoundError("Application");
  const [kyb, website, screenings] = await Promise.all([
    adapters.kyb.verify({ legalName: m.legalName, registrationNo: m.registrationNo, country: m.country }),
    adapters.website.check(m.website),
    Promise.all(m.owners.map(async (o) => ({ owner: o, matches: await adapters.watchlist.screen({ fullName: o.fullName, dateOfBirth: o.dateOfBirth, nationality: o.nationality }) }))),
  ]);
  await db.$transaction(async (tx) => {
    await tx.application.update({ where: { id: app.id }, data: { checks: { kyb, website } as never } });
    for (const s of screenings) {
      for (const match of s.matches) {
        const exists = await tx.watchlistHit.findFirst({ where: { ownerId: s.owner.id, listName: match.listName, matchedName: match.matchedName } });
        if (!exists) await tx.watchlistHit.create({ data: { ownerId: s.owner.id, listName: match.listName, matchedName: match.matchedName, matchScore: match.matchScore } });
      }
      const status = s.matches.length ? "POTENTIAL_MATCH" : "CLEAR";
      if (s.owner.screeningStatus === "NOT_SCREENED" || s.owner.screeningStatus === "CLEAR") {
        await tx.owner.update({ where: { id: s.owner.id }, data: { screeningStatus: status } });
      }
    }
    await record(tx, SYSTEM_ACTOR, { action: "UNDERWRITING_CHECKS_COMPLETED", entityType: "Application", entityId: app.id, after: { kyb: kyb.status, website: website.live, hits: screenings.reduce((a, s) => a + s.matches.length, 0) } });
  });
  const score = await rescoreMerchant(merchantId, "ONBOARDING");
  await db.$transaction(async (tx) => {
    await refreshChecklist(tx, app.id, score.band);
    if (m.status === "SUBMITTED") await transitionMerchant(tx, merchantId, "IN_UNDERWRITING", SYSTEM_ACTOR, { trigger: "CHECKS_COMPLETED" });
    const existing = await tx.case.findFirst({ where: { merchantId, type: "UNDERWRITING", status: { in: OPEN_CASE_STATES } } });
    if (!existing) {
      await openCaseForMerchant(tx, {
        merchantId,
        type: "UNDERWRITING",
        priority: PRIORITY_BY_BAND[score.band],
        title: score.band === "PROHIBITED" ? "Application hit a hard stop" : `New application, ${score.band.toLowerCase()} risk`,
        payload: { applicationId: app.id, band: score.band, score: score.score },
        slaHours: score.band === "HIGH" || score.band === "PROHIBITED" ? 72 : 48,
      });
    }
  });
  return score;
}

export async function updateChecklistItem(actor: Actor & { id: string }, applicationId: string, key: string, status: ChecklistStatus, note: string | undefined) {
  if (!can(actor.role, "underwriting.decide.standard")) throw new ForbiddenError();
  if (status === "WAIVED" && !note?.trim()) throw new DomainError("NOTE_REQUIRED", "A waived item needs a note explaining why.");
  return db.$transaction(async (tx) => {
    const app = await tx.application.findUnique({ where: { id: applicationId }, include: { merchant: true } });
    if (!app) throw new NotFoundError("Application");
    if (app.decidedAt) throw new ConflictError("This application has already been decided.");
    const c = app.checklist as unknown as Checklist;
    const item = c.items.find((i) => i.key === key);
    if (!item) throw new NotFoundError("Checklist item");
    if (key === "screening_clear") throw new DomainError("AUTO_ITEM", "Screening clears when every watchlist hit is reviewed on the Ownership tab.");
    const before = { ...item };
    item.status = status;
    item.note = note ?? null;
    item.auto = false;
    item.updatedById = actor.id;
    item.updatedAt = (await now(tx)).toISOString();
    await tx.application.update({ where: { id: applicationId }, data: { checklist: c as never } });
    await record(tx, actor, { action: "CHECKLIST_ITEM_SET", entityType: "Application", entityId: applicationId, before: { key, status: before.status }, after: { key, status, note } });
    return c;
  });
}

export const DecisionSchema = z.object({
  decision: z.enum(["APPROVED", "APPROVED_WITH_CONDITIONS", "DECLINED", "REQUEST_INFO"]),
  reasonCode: z.string().optional(),
  note: z.string().trim().default(""),
  effectiveFrom: z.string().date().optional(),
  controls: z
    .array(z.intersection(ControlParamsSchema, z.object({ reasonCode: z.string().min(1), note: z.string().trim().min(3), reviewAt: z.string().date() })))
    .default([]),
  rfi: z
    .object({
      items: z.array(z.object({ key: z.string(), label: z.string(), docType: z.string(), required: z.boolean() })).min(1),
      message: z.string().trim().min(10),
      dueAt: z.string().date(),
    })
    .optional(),
});
export type DecisionInput = z.infer<typeof DecisionSchema>;

/** Decide an application (PRD §6.1). PROHIBITED can only be declined, or overridden via four-eyes. */
export async function decideApplication(actor: Actor & { id: string }, applicationId: string, raw: unknown) {
  const input = DecisionSchema.parse(raw);
  const app = await db.application.findUnique({ where: { id: applicationId }, include: { merchant: true } });
  if (!app) throw new NotFoundError("Application");
  const band = app.merchant.currentBand;
  if (app.decidedAt) throw new ConflictError("This application has already been decided.");
  if (!["IN_UNDERWRITING", "PENDING_INFO"].includes(app.merchant.status)) throw new ConflictError("This application is not in underwriting.");

  if (band === "PROHIBITED" && input.decision !== "DECLINED") {
    if (input.decision === "REQUEST_INFO") throw new DomainError("PROHIBITED", "A prohibited application can only be declined or overridden.");
    if (!can(actor.role, "underwriting.decide.high")) throw new ForbiddenError("Only a senior underwriter or head of risk can request an override.");
    validateDecision(input, app.checklist as unknown as Checklist);
    return db.$transaction(async (tx) => {
      const pending = await tx.approvalRequest.findFirst({ where: { actionType: "OVERRIDE_PROHIBITED", status: "PENDING", payload: { path: ["applicationId"], equals: applicationId } } });
      if (pending) throw new ConflictError("An override for this application is already waiting for approval.");
      const uw = await tx.case.findFirst({ where: { merchantId: app.merchantId, type: "UNDERWRITING", status: { in: OPEN_CASE_STATES } } });
      if (uw && (uw.status === "NEW" || uw.status === "ASSIGNED" || uw.status === "REOPENED")) await transitionCase(uw.id, "IN_REVIEW", actor, {}, tx);
      const req = await requestApproval(tx, {
        actionType: "OVERRIDE_PROHIBITED",
        payload: { applicationId, ...input },
        merchantId: app.merchantId,
        caseId: uw?.id ?? null,
        summary: `Override a hard stop and ${input.decision === "APPROVED" ? "approve" : "approve with conditions"} ${app.merchant.dbaName ?? app.merchant.legalName}`,
        actor,
      });
      return { status: "PENDING_APPROVAL" as const, approvalId: req.id };
    });
  }
  if (input.decision !== "REQUEST_INFO" && (!actor.role || !canDecideBand(actor.role, band === "PROHIBITED" ? "MEDIUM" : band))) {
    throw new ForbiddenError(band === "HIGH" ? "High-risk applications need a senior underwriter." : undefined);
  }
  if (input.decision === "REQUEST_INFO" && !can(actor.role, "underwriting.decide.standard")) throw new ForbiddenError();
  if (input.decision !== "REQUEST_INFO" && input.decision !== "DECLINED") validateDecision(input, app.checklist as unknown as Checklist);
  if (input.decision === "DECLINED" && !input.reasonCode) throw new DomainError("REASON_REQUIRED", "Choose a reason code for the decline.");
  return db.$transaction((tx) => executeDecision(tx, applicationId, input, actor), { timeout: 30_000 });
}

function validateDecision(input: DecisionInput, checklist: Checklist) {
  const missing = missingItems(checklist);
  if (missing.length) {
    throw new DomainError("CHECKLIST_INCOMPLETE", `Complete the checklist first: ${missing.map((m) => m.label.toLowerCase()).join("; ")}.`, 422, { missing: missing.map((m) => m.key) });
  }
  if (!input.reasonCode) throw new DomainError("REASON_REQUIRED", "Choose an underwriting reason code.");
  if (input.decision === "APPROVED_WITH_CONDITIONS" && input.controls.length === 0) {
    throw new DomainError("CONDITIONS_REQUIRED", "Approving with conditions needs at least one control.");
  }
}

/** Shared by a direct decision and by an approved OVERRIDE_PROHIBITED request. */
export async function executeDecision(tx: Tx, applicationId: string, input: DecisionInput, actor: Actor, opts: { override?: boolean } = {}) {
  const app = await tx.application.findUniqueOrThrow({ where: { id: applicationId }, include: { merchant: true } });
  const merchantId = app.merchantId;
  const at = await now(tx);
  const today = await simToday(tx);
  const uw = await tx.case.findFirst({ where: { merchantId, type: "UNDERWRITING", status: { in: OPEN_CASE_STATES } } });
  if (uw && (uw.status === "NEW" || uw.status === "ASSIGNED" || uw.status === "REOPENED")) await transitionCase(uw.id, "IN_REVIEW", actor, {}, tx);

  if (input.decision === "REQUEST_INFO") {
    if (!input.rfi) throw new DomainError("RFI_REQUIRED", "List the documents you need.");
    if (!uw) throw new ConflictError("No open underwriting case to attach the request to.");
    const rfi = await sendRfi(uw.id, { items: input.rfi.items, message: input.rfi.message, dueAt: new Date(input.rfi.dueAt) }, actor, tx);
    await record(tx, actor, { action: "UNDERWRITING_INFO_REQUESTED", entityType: "Application", entityId: applicationId, after: { rfiId: rfi.id } });
    return { status: "PENDING_INFO" as const, rfiToken: rfi.token };
  }

  if (app.merchant.status === "PENDING_INFO") await transitionMerchant(tx, merchantId, "IN_UNDERWRITING", actor, { trigger: "DECISION" });
  const effectiveFrom = input.effectiveFrom ? utcDay(new Date(input.effectiveFrom)) : today;
  await tx.application.update({
    where: { id: applicationId },
    data: { decision: input.decision, decisionReasonCode: input.reasonCode, decisionNote: input.note, decidedById: actor.id, decidedAt: at, effectiveFrom },
  });
  const rc = input.reasonCode ? await tx.reasonCode.findUnique({ where: { code: input.reasonCode } }) : null;
  await record(tx, actor, {
    action: opts.override ? "UNDERWRITING_DECIDED_OVERRIDE" : "UNDERWRITING_DECIDED",
    entityType: "Application",
    entityId: applicationId,
    after: { decision: input.decision, reasonCode: input.reasonCode, note: input.note, band: app.merchant.currentBand, score: app.merchant.currentScore },
  });

  if (input.decision === "DECLINED") {
    await transitionMerchant(tx, merchantId, "DECLINED", actor, { trigger: "UNDERWRITING_DECISION", reasonCode: input.reasonCode, note: input.note });
    if (uw) {
      await tx.caseEvent.create({ data: { caseId: uw.id, actorId: actor.id, type: "DECISION", payload: { decision: "DECLINED", reasonCode: input.reasonCode, note: input.note, merchantNotice: rc?.merchantFacingText ?? null }, createdAt: at } });
      await transitionCase(uw.id, "RESOLVED", actor, { reasonCode: "CR-UW-DECIDED", note: `Declined: ${rc?.label ?? input.reasonCode}. ${input.note}`.trim() }, tx);
    }
    return { status: "DECLINED" as const };
  }

  await transitionMerchant(tx, merchantId, "APPROVED", actor, { trigger: "UNDERWRITING_DECISION", reasonCode: input.reasonCode, note: input.note });
  let pendingApproval = false;
  for (const c of input.controls) {
    const res = await createControl(actor as Actor & { id: string }, { ...c, merchantId, caseId: uw?.id, effectiveFrom: input.effectiveFrom }, tx);
    if (res.approval) pendingApproval = true;
  }
  if (uw) {
    await tx.caseEvent.create({ data: { caseId: uw.id, actorId: actor.id, type: "DECISION", payload: { decision: input.decision, reasonCode: input.reasonCode, note: input.note, controls: input.controls.length }, createdAt: at } });
    // With a control waiting for approval the case waits too; otherwise it is resolved now.
    const fresh = await tx.case.findUniqueOrThrow({ where: { id: uw.id } });
    if (fresh.status === "IN_REVIEW") {
      await transitionCase(uw.id, "RESOLVED", actor, { reasonCode: "CR-UW-DECIDED", note: `${input.decision === "APPROVED" ? "Approved" : "Approved with conditions"}: ${rc?.label ?? ""}. ${input.note}`.trim() }, tx);
    }
  }
  if (!pendingApproval && effectiveFrom <= today) await activateIfReady(tx, merchantId, actor);
  return { status: pendingApproval ? ("APPROVED_PENDING_CONTROLS" as const) : ("APPROVED" as const) };
}

/** APPROVED -> ACTIVE when the effective date has come and no condition is still waiting for approval. */
export async function activateIfReady(tx: Tx, merchantId: string, actor: Actor = SYSTEM_ACTOR) {
  const m = await tx.merchant.findUnique({ where: { id: merchantId }, include: { applications: { orderBy: { submittedAt: "desc" }, take: 1 } } });
  if (m?.status !== "APPROVED") return false;
  const today = await simToday(tx);
  const eff = m.applications[0]?.effectiveFrom;
  if (eff && utcDay(eff) > today) return false;
  const pending = await tx.control.count({ where: { merchantId, status: "PENDING_APPROVAL" } });
  if (pending > 0) return false;
  await transitionMerchant(tx, merchantId, "ACTIVE", actor, { trigger: "EFFECTIVE_DATE_REACHED" }, { activatedAt: await now(tx) });
  return true;
}

export async function activateApprovedMerchants(): Promise<number> {
  const approved = await db.merchant.findMany({ where: { status: "APPROVED" }, select: { id: true } });
  let n = 0;
  for (const m of approved) if (await db.$transaction((tx) => activateIfReady(tx, m.id))) n++;
  return n;
}

/** Review a watchlist hit on the Ownership tab; re-scores the merchant (PRD §6.2 re-scoring triggers). */
export async function reviewWatchlistHit(actor: Actor & { id: string }, hitId: string, status: "FALSE_POSITIVE" | "CONFIRMED", note: string) {
  if (!can(actor.role, "case.work")) throw new ForbiddenError();
  if (!note.trim()) throw new DomainError("NOTE_REQUIRED", "Explain how you reached this conclusion.");
  const hit = await db.watchlistHit.findUnique({ where: { id: hitId }, include: { owner: { include: { hits: true, merchant: true } } } });
  if (!hit) throw new NotFoundError("Watchlist hit");
  if (hit.status !== "PENDING_REVIEW") throw new ConflictError("This hit has already been reviewed.");
  const merchantId = hit.owner.merchantId;
  await db.$transaction(async (tx) => {
    await tx.watchlistHit.update({ where: { id: hitId }, data: { status, reviewedById: actor.id, reviewNote: note, reviewedAt: await now(tx) } });
    const others = hit.owner.hits.filter((h) => h.id !== hitId);
    const ownerStatus =
      status === "CONFIRMED" || others.some((h) => h.status === "CONFIRMED") ? "CONFIRMED_MATCH" : others.some((h) => h.status === "PENDING_REVIEW") ? "POTENTIAL_MATCH" : "CLEAR";
    await tx.owner.update({ where: { id: hit.ownerId }, data: { screeningStatus: ownerStatus } });
    await record(tx, actor, { action: "WATCHLIST_HIT_REVIEWED", entityType: "WatchlistHit", entityId: hitId, before: { status: hit.status }, after: { status, note, owner: hit.owner.fullName } });
    if (status === "CONFIRMED" && ["ACTIVE", "UNDER_REVIEW", "RESTRICTED"].includes(hit.owner.merchant.status)) {
      const open = await tx.case.findFirst({ where: { merchantId, type: "WATCHLIST", status: { in: OPEN_CASE_STATES } } });
      if (!open) {
        await openCaseForMerchant(tx, {
          merchantId,
          type: "WATCHLIST",
          priority: "CRITICAL",
          title: `Confirmed watchlist match: ${hit.owner.fullName}`,
          actor,
          payload: { hitId, listName: hit.listName, matchedName: hit.matchedName },
        });
      }
    }
  });
  await rescoreMerchant(merchantId, "EVENT", actor);
  const app = await db.application.findFirst({ where: { merchantId }, orderBy: { submittedAt: "desc" } });
  const m = await db.merchant.findUniqueOrThrow({ where: { id: merchantId } });
  if (app && !app.decidedAt) await db.$transaction((tx) => refreshChecklist(tx, app.id, m.currentBand));
}

export { transitionMerchantIfAllowed };
