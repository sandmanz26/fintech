import type { Role, RiskBand } from "@prisma/client";

/**
 * Permission matrix, PRD §3.2. Enforced on the server (route handlers and services);
 * the UI reads the same table only to hide controls a role cannot use.
 */
export type Capability =
  | "merchant.read"
  | "portfolio.read"
  | "underwriting.decide.standard" // LOW / MEDIUM
  | "underwriting.decide.high"
  | "underwriting.override_prohibited"
  | "case.work"
  | "case.read"
  | "control.limit" // volume limits, max ticket, payout delay
  | "control.reserve.small" // reserve below the four-eyes threshold
  | "control.propose" // anything else: becomes an approval request
  | "approval.decide"
  | "approval.decide.termination_compliance"
  | "rules.read"
  | "rules.write"
  | "audit.read"
  | "audit.verify"
  | "users.manage"
  | "policy.write"
  | "reasoncodes.write"
  | "merchant.rescore"
  | "owner.pii.read"
  | "rfi.answer";

const INTERNAL: Role[] = ["ANALYST", "SENIOR_ANALYST", "RISK_MANAGER", "COMPLIANCE", "AUDITOR", "ADMIN"];

export const MATRIX: Record<Capability, Role[]> = {
  "merchant.read": INTERNAL,
  "portfolio.read": INTERNAL,
  "underwriting.decide.standard": ["ANALYST", "SENIOR_ANALYST", "RISK_MANAGER"],
  "underwriting.decide.high": ["SENIOR_ANALYST", "RISK_MANAGER"],
  "underwriting.override_prohibited": ["RISK_MANAGER"],
  "case.work": ["ANALYST", "SENIOR_ANALYST", "RISK_MANAGER", "COMPLIANCE"],
  "case.read": ["ANALYST", "SENIOR_ANALYST", "RISK_MANAGER", "COMPLIANCE", "AUDITOR"],
  "control.limit": ["ANALYST", "SENIOR_ANALYST", "RISK_MANAGER"],
  "control.reserve.small": ["SENIOR_ANALYST", "RISK_MANAGER"],
  "control.propose": ["ANALYST", "SENIOR_ANALYST", "RISK_MANAGER"],
  "approval.decide": ["RISK_MANAGER"],
  "approval.decide.termination_compliance": ["RISK_MANAGER", "COMPLIANCE"],
  "rules.read": ["SENIOR_ANALYST", "RISK_MANAGER", "COMPLIANCE", "AUDITOR"],
  "rules.write": ["RISK_MANAGER"],
  "audit.read": ["SENIOR_ANALYST", "RISK_MANAGER", "COMPLIANCE", "AUDITOR", "ADMIN"],
  "audit.verify": ["AUDITOR", "ADMIN"],
  "users.manage": ["ADMIN"],
  "policy.write": ["ADMIN", "RISK_MANAGER"],
  "reasoncodes.write": ["ADMIN", "RISK_MANAGER"],
  "merchant.rescore": ["SENIOR_ANALYST", "RISK_MANAGER"],
  "owner.pii.read": ["SENIOR_ANALYST", "RISK_MANAGER", "COMPLIANCE"],
  "rfi.answer": ["MERCHANT"],
};

export function can(role: Role | null | undefined, cap: Capability): boolean {
  if (!role) return false;
  return MATRIX[cap].includes(role);
}

export function isInternal(role: Role | null | undefined): boolean {
  return !!role && INTERNAL.includes(role);
}

/** Who may decide an application in this band (PRD §6.1 routing table). */
export function canDecideBand(role: Role, band: RiskBand | null): boolean {
  if (band === "HIGH") return can(role, "underwriting.decide.high");
  if (band === "PROHIBITED") return false; // only via four-eyes OVERRIDE_PROHIBITED
  return can(role, "underwriting.decide.standard");
}

export const ROLE_LABEL: Record<Role, string> = {
  ANALYST: "Risk analyst",
  SENIOR_ANALYST: "Senior underwriter",
  RISK_MANAGER: "Head of risk",
  COMPLIANCE: "Compliance officer",
  AUDITOR: "Auditor",
  ADMIN: "System admin",
  MERCHANT: "Merchant",
};

/** Seniority used for "higher role" in four-eyes and queue routing. */
export const ROLE_RANK: Record<Role, number> = {
  MERCHANT: 0,
  AUDITOR: 0,
  ADMIN: 0,
  ANALYST: 1,
  SENIOR_ANALYST: 2,
  COMPLIANCE: 3,
  RISK_MANAGER: 4,
};

export class ForbiddenError extends Error {
  status = 403;
  constructor(message = "You do not have permission to do that.") {
    super(message);
  }
}

export function assertCan(role: Role | null | undefined, cap: Capability, message?: string): void {
  if (!can(role, cap)) throw new ForbiddenError(message);
}
