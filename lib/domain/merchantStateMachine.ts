import type { MerchantStatus } from "@prisma/client";
import { IllegalTransitionError } from "@/lib/errors";

/** PRD §7.1 — every allowed merchant status transition, and nothing else. */
export const MERCHANT_TRANSITIONS: Record<MerchantStatus, MerchantStatus[]> = {
  APPLICATION_DRAFT: ["SUBMITTED"],
  SUBMITTED: ["IN_UNDERWRITING"],
  IN_UNDERWRITING: ["PENDING_INFO", "APPROVED", "DECLINED"],
  PENDING_INFO: ["IN_UNDERWRITING"],
  APPROVED: ["ACTIVE"],
  DECLINED: [],
  ACTIVE: ["UNDER_REVIEW", "CLOSED"],
  UNDER_REVIEW: ["ACTIVE", "RESTRICTED", "TERMINATION_PENDING"],
  RESTRICTED: ["ACTIVE", "TERMINATION_PENDING"],
  TERMINATION_PENDING: ["TERMINATED"],
  TERMINATED: [],
  CLOSED: [],
};

export const TERMINAL_MERCHANT_STATES: MerchantStatus[] = ["DECLINED", "TERMINATED", "CLOSED"];

export function canTransitionMerchant(from: MerchantStatus, to: MerchantStatus): boolean {
  return MERCHANT_TRANSITIONS[from].includes(to);
}

export function assertMerchantTransition(from: MerchantStatus, to: MerchantStatus): void {
  if (!canTransitionMerchant(from, to)) throw new IllegalTransitionError("Merchant", from, to);
}

/** Statuses in which the merchant is processing payments and is monitored. */
export const PROCESSING_STATES: MerchantStatus[] = ["ACTIVE", "UNDER_REVIEW", "RESTRICTED"];

export const MERCHANT_STATUS_LABEL: Record<MerchantStatus, string> = {
  APPLICATION_DRAFT: "Draft application",
  SUBMITTED: "Submitted",
  IN_UNDERWRITING: "In underwriting",
  PENDING_INFO: "Waiting on merchant",
  APPROVED: "Approved",
  DECLINED: "Declined",
  ACTIVE: "Active",
  UNDER_REVIEW: "Under review",
  RESTRICTED: "Restricted",
  TERMINATION_PENDING: "Termination pending",
  TERMINATED: "Terminated",
  CLOSED: "Closed",
};
