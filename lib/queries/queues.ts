import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { now } from "@/lib/clock";
import { OPEN_CASE_STATES } from "@/lib/domain/caseStateMachine";
import type { SessionUser } from "@/lib/api";
import { approverRolesFor } from "@/lib/domain/approvals/policy";

/** Queue definitions (PRD §6.4). One place, used by the sidebar counts and the queue pages. */
export const QUEUES = {
  "my-work": { label: "My work", empty: "Nothing assigned to you. Pick up a case from Unassigned." },
  unassigned: { label: "Unassigned", empty: "Every open case has an owner." },
  "alerts-untriaged": { label: "Alerts to triage", empty: "No alerts waiting outside a case." },
  "awaiting-merchant": { label: "Waiting on merchant", empty: "No requests are out with merchants." },
  "breaching-sla": { label: "Breaching SLA", empty: "Nothing is past or within two hours of its SLA." },
  "underwriting-standard": { label: "Underwriting · standard", empty: "No low or medium applications waiting." },
  "underwriting-enhanced": { label: "Underwriting · enhanced", empty: "No high-risk applications waiting." },
} as const;
export type QueueKey = keyof typeof QUEUES;

export async function caseWhere(queue: QueueKey, user: SessionUser): Promise<Prisma.CaseWhereInput | null> {
  const at = await now();
  const open = { status: { in: OPEN_CASE_STATES } };
  switch (queue) {
    case "my-work":
      return { ...open, assigneeId: user.id };
    case "unassigned":
      return { status: "NEW", type: { not: "UNDERWRITING" } };
    case "awaiting-merchant":
      return { status: "AWAITING_MERCHANT" };
    case "breaching-sla":
      return { ...open, type: { not: "OFFBOARDING" }, slaDueAt: { lt: new Date(at.getTime() + 2 * 3_600_000) } };
    default:
      return null;
  }
}

export function applicationWhere(queue: QueueKey): Prisma.MerchantWhereInput | null {
  if (queue === "underwriting-standard") return { status: { in: ["IN_UNDERWRITING", "PENDING_INFO"] }, currentBand: { in: ["LOW", "MEDIUM"] } };
  if (queue === "underwriting-enhanced") return { status: { in: ["IN_UNDERWRITING", "PENDING_INFO"] }, currentBand: { in: ["HIGH", "PROHIBITED"] } };
  return null;
}

export async function sidebarCounts(user: SessionUser) {
  const [mine, unassigned, alerts, awaiting, breaching, std, enh, approvals, notifications] = await Promise.all([
    db.case.count({ where: (await caseWhere("my-work", user))! }),
    db.case.count({ where: (await caseWhere("unassigned", user))! }),
    db.alert.count({ where: { status: "OPEN" } }),
    db.case.count({ where: (await caseWhere("awaiting-merchant", user))! }),
    db.case.count({ where: (await caseWhere("breaching-sla", user))! }),
    db.merchant.count({ where: applicationWhere("underwriting-standard")! }),
    db.merchant.count({ where: applicationWhere("underwriting-enhanced")! }),
    pendingApprovalsFor(user).then((r) => r.length),
    db.notification.count({ where: { readAt: null, OR: [{ userId: user.id }, { role: user.role, userId: null }] } }),
  ]);
  return { mine, unassigned, alerts, awaiting, breaching, std, enh, approvals, notifications };
}

/** Requests this user may decide: right role, not their own. */
export async function pendingApprovalsFor(user: SessionUser) {
  const pending = await db.approvalRequest.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" } });
  return pending.filter((r) => r.requestedById !== user.id && approverRolesFor(r.actionType, r.payload as never).includes(user.role));
}
