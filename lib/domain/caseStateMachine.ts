import type { CaseStatus } from "@prisma/client";
import { IllegalTransitionError } from "@/lib/errors";

/** PRD §7.2 — case status transitions. */
export const CASE_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  NEW: ["ASSIGNED"],
  ASSIGNED: ["IN_REVIEW", "ASSIGNED"], // ASSIGNED -> ASSIGNED is a reassign
  IN_REVIEW: ["AWAITING_MERCHANT", "PENDING_APPROVAL", "RESOLVED"],
  AWAITING_MERCHANT: ["IN_REVIEW"],
  PENDING_APPROVAL: ["IN_REVIEW", "RESOLVED"],
  RESOLVED: ["REOPENED"],
  REOPENED: ["IN_REVIEW"],
};

export const OPEN_CASE_STATES: CaseStatus[] = ["NEW", "ASSIGNED", "IN_REVIEW", "AWAITING_MERCHANT", "PENDING_APPROVAL", "REOPENED"];

export function canTransitionCase(from: CaseStatus, to: CaseStatus): boolean {
  return CASE_TRANSITIONS[from].includes(to);
}

export function assertCaseTransition(from: CaseStatus, to: CaseStatus): void {
  if (!canTransitionCase(from, to)) throw new IllegalTransitionError("Case", from, to);
}

export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  NEW: "New",
  ASSIGNED: "Assigned",
  IN_REVIEW: "In review",
  AWAITING_MERCHANT: "Waiting on merchant",
  PENDING_APPROVAL: "Waiting on approval",
  RESOLVED: "Resolved",
  REOPENED: "Reopened",
};
