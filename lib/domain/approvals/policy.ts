import type { Role } from "@prisma/client";

/**
 * Four-eyes rules (PRD §3.2, §6.7). Pure so they can be tested on their own;
 * ApprovalService calls `checkCanDecide` inside the same transaction that executes the action.
 */

export type ApprovalActionType = "APPLY_CONTROL" | "TERMINATE" | "OVERRIDE_PROHIBITED" | "REMOVE_RESERVE" | "REMOVE_CONTROL";

export type ApprovalLike = {
  status: string;
  actionType: string;
  requestedById: string;
  approverRole: Role;
  payload: { reasonCategory?: string } & Record<string, unknown>;
};

/** Roles that may approve an action of this type (column "A" of the matrix). */
export function approverRolesFor(actionType: string, payload: ApprovalLike["payload"]): Role[] {
  if (actionType === "TERMINATE") {
    // Compliance may approve terminations whose reason is compliance / sanctions.
    return payload.reasonCategory === "COMPLIANCE" ? ["RISK_MANAGER", "COMPLIANCE"] : ["RISK_MANAGER"];
  }
  if (actionType === "ADD_TO_TERMINATED_LIST") return ["RISK_MANAGER", "COMPLIANCE"];
  return ["RISK_MANAGER"];
}

export type DecideCheck = { ok: true } | { ok: false; code: string; message: string };

export function checkCanDecide(req: ApprovalLike, decider: { id: string; role: Role }): DecideCheck {
  if (req.status !== "PENDING") return { ok: false, code: "NOT_PENDING", message: "This request has already been decided or cancelled." };
  if (decider.id === req.requestedById) {
    return { ok: false, code: "SAME_PERSON", message: "You cannot approve a request you made. A second person must decide it." };
  }
  const allowed = approverRolesFor(req.actionType, req.payload);
  if (!allowed.includes(decider.role)) {
    return { ok: false, code: "WRONG_ROLE", message: `This request needs a ${allowed.map((r) => r.toLowerCase().replace("_", " ")).join(" or ")}.` };
  }
  return { ok: true };
}

export function checkCanCancel(req: ApprovalLike, user: { id: string }): DecideCheck {
  if (req.status !== "PENDING") return { ok: false, code: "NOT_PENDING", message: "Only pending requests can be cancelled." };
  if (user.id !== req.requestedById) return { ok: false, code: "NOT_REQUESTER", message: "Only the person who made the request can cancel it." };
  return { ok: true };
}
