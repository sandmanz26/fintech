import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { record, type Actor } from "@/lib/domain/audit";
import { now } from "@/lib/clock";
import { DomainError, NotFoundError } from "@/lib/errors";
import { approverRolesFor, checkCanCancel, checkCanDecide } from "./policy";

/**
 * Four-eyes (PRD §6.7). A request stores the full payload of the action; approving it runs the
 * action inside the same database transaction as the status change, so either both happen or
 * neither does.
 */
export async function requestApproval(
  tx: Tx,
  input: {
    actionType: string;
    payload: Record<string, unknown>;
    merchantId: string | null;
    caseId: string | null;
    summary: string;
    actor: Actor & { id: string };
  },
) {
  const roles = approverRolesFor(input.actionType, input.payload as never);
  const at = await now(tx);
  const req = await tx.approvalRequest.create({
    data: {
      actionType: input.actionType,
      payload: input.payload as Prisma.InputJsonValue,
      merchantId: input.merchantId,
      caseId: input.caseId,
      summary: input.summary,
      requestedById: input.actor.id,
      approverRole: roles[0],
      createdAt: at,
    },
  });
  await record(tx, input.actor, { action: "APPROVAL_REQUESTED", entityType: "ApprovalRequest", entityId: req.id, after: { actionType: req.actionType, summary: req.summary, merchantId: req.merchantId } });
  if (input.caseId) {
    const c = await tx.case.findUnique({ where: { id: input.caseId } });
    if (c) {
      if (c.status === "IN_REVIEW") await tx.case.update({ where: { id: c.id }, data: { status: "PENDING_APPROVAL" } });
      await tx.caseEvent.create({
        data: { caseId: c.id, actorId: input.actor.id, type: "STATUS_CHANGE", payload: { from: c.status, to: c.status === "IN_REVIEW" ? "PENDING_APPROVAL" : c.status, approvalId: req.id, summary: input.summary }, createdAt: at },
      });
    }
  }
  for (const role of roles) {
    await tx.notification.create({ data: { role, kind: "APPROVAL", title: `Approval needed: ${input.summary}`, href: `/approvals?id=${req.id}` } });
  }
  return req;
}

export async function decideApproval(approvalId: string, decision: "APPROVE" | "REJECT", note: string, actor: Actor & { id: string }) {
  if (!note.trim()) throw new DomainError("NOTE_REQUIRED", "Write a note explaining your decision.");
  return db.$transaction(
    async (tx) => {
      // Lock the row so two approvers cannot both act on it.
      await tx.$queryRaw`SELECT id FROM "ApprovalRequest" WHERE id = ${approvalId} FOR UPDATE`;
      const req = await tx.approvalRequest.findUnique({ where: { id: approvalId } });
      if (!req) throw new NotFoundError("Approval request");
      const check = checkCanDecide(
        { status: req.status, actionType: req.actionType, requestedById: req.requestedById, approverRole: req.approverRole, payload: req.payload as never },
        actor as { id: string; role: never },
      );
      if (!check.ok) throw new DomainError(check.code, check.message, check.code === "WRONG_ROLE" || check.code === "SAME_PERSON" ? 403 : 409);
      const at = await now(tx);
      const status = decision === "APPROVE" ? "APPROVED" : "REJECTED";
      await tx.approvalRequest.update({ where: { id: approvalId }, data: { status, decidedById: actor.id, decisionNote: note, decidedAt: at } });
      await record(tx, actor, { action: decision === "APPROVE" ? "APPROVAL_APPROVED" : "APPROVAL_REJECTED", entityType: "ApprovalRequest", entityId: approvalId, before: { status: req.status }, after: { status, note } });

      const payload = req.payload as Record<string, unknown>;
      if (decision === "APPROVE") await execute(tx, req.actionType, payload, actor, req.merchantId);
      else await onRejected(tx, req.actionType, payload, actor);

      if (req.caseId) {
        const c = await tx.case.findUnique({ where: { id: req.caseId } });
        if (c?.status === "PENDING_APPROVAL") {
          const to = decision === "APPROVE" ? "RESOLVED" : "IN_REVIEW";
          const resolutionCode = decision === "APPROVE" ? resolutionFor(req.actionType) : null;
          await tx.case.update({
            where: { id: c.id },
            data: { status: to, ...(to === "RESOLVED" ? { resolvedAt: at, resolutionCode, resolutionNote: note } : {}) },
          });
          await tx.caseEvent.create({
            data: { caseId: c.id, actorId: actor.id, type: "DECISION", payload: { approvalId, decision, note, from: c.status, to, summary: req.summary }, createdAt: at },
          });
          await record(tx, actor, { action: "CASE_STATUS_CHANGED", entityType: "Case", entityId: c.id, before: { status: c.status }, after: { status: to, approvalId } });
        }
      }
      await tx.notification.create({
        data: { userId: req.requestedById, kind: "APPROVAL_DECIDED", title: `${decision === "APPROVE" ? "Approved" : "Rejected"}: ${req.summary}`, href: req.caseId ? `/cases/${req.caseId}` : `/approvals` },
      });
      return { status };
    },
    { timeout: 30_000 },
  );
}

function resolutionFor(actionType: string) {
  switch (actionType) {
    case "TERMINATE":
      return "CR-TERMINATED";
    case "APPLY_CONTROL":
      return "CR-CONTROL-APPLIED";
    case "REMOVE_RESERVE":
    case "REMOVE_CONTROL":
      return "CR-CONTROL-REMOVED";
    default:
      return "CR-OTHER";
  }
}

async function execute(tx: Tx, actionType: string, p: Record<string, unknown>, actor: Actor, merchantId: string | null) {
  switch (actionType) {
    case "APPLY_CONTROL": {
      const { activateControl } = await import("@/lib/domain/controls/service");
      await activateControl(tx, String(p.controlId), actor);
      return;
    }
    case "REMOVE_RESERVE":
    case "REMOVE_CONTROL": {
      const { executeRemoveControl } = await import("@/lib/domain/controls/service");
      await executeRemoveControl(tx, String(p.controlId), actor, { reasonCode: String(p.reasonCode ?? ""), note: String(p.note ?? "") });
      return;
    }
    case "TERMINATE": {
      const { executeTermination } = await import("@/lib/domain/offboarding/service");
      await executeTermination(tx, String(merchantId ?? p.merchantId), p as never, actor);
      return;
    }
    case "OVERRIDE_PROHIBITED": {
      const { executeDecision } = await import("@/lib/domain/underwriting/service");
      await executeDecision(tx, String(p.applicationId), p as never, actor, { override: true });
      return;
    }
    default:
      throw new DomainError("UNKNOWN_ACTION", `No executor for ${actionType}.`);
  }
}

async function onRejected(tx: Tx, actionType: string, p: Record<string, unknown>, actor: Actor) {
  if (actionType === "APPLY_CONTROL") {
    const { rejectPendingControl } = await import("@/lib/domain/controls/service");
    await rejectPendingControl(tx, String(p.controlId), actor);
  }
}

export async function cancelApproval(approvalId: string, actor: Actor & { id: string }) {
  return db.$transaction(async (tx) => {
    const req = await tx.approvalRequest.findUnique({ where: { id: approvalId } });
    if (!req) throw new NotFoundError("Approval request");
    const check = checkCanCancel({ status: req.status, actionType: req.actionType, requestedById: req.requestedById, approverRole: req.approverRole, payload: req.payload as never }, actor);
    if (!check.ok) throw new DomainError(check.code, check.message, 409);
    await tx.approvalRequest.update({ where: { id: approvalId }, data: { status: "CANCELLED", decidedAt: await now(tx) } });
    await onRejected(tx, req.actionType, req.payload as Record<string, unknown>, actor);
    await record(tx, actor, { action: "APPROVAL_CANCELLED", entityType: "ApprovalRequest", entityId: approvalId, before: { status: "PENDING" }, after: { status: "CANCELLED" } });
    if (req.caseId) {
      const c = await tx.case.findUnique({ where: { id: req.caseId } });
      if (c?.status === "PENDING_APPROVAL") {
        await tx.case.update({ where: { id: c.id }, data: { status: "IN_REVIEW" } });
        await tx.caseEvent.create({ data: { caseId: c.id, actorId: actor.id, type: "STATUS_CHANGE", payload: { from: "PENDING_APPROVAL", to: "IN_REVIEW", reason: "Request cancelled by requester", approvalId } } });
      }
    }
  });
}
