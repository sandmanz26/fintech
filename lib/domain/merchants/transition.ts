import type { MerchantStatus } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { record, type Actor } from "@/lib/domain/audit";
import { assertMerchantTransition, canTransitionMerchant } from "@/lib/domain/merchantStateMachine";
import { NotFoundError } from "@/lib/errors";

/**
 * The only way a merchant's status changes. Validates against the transition table and
 * writes the audit row in the caller's transaction.
 */
export async function transitionMerchant(
  tx: Tx,
  merchantId: string,
  to: MerchantStatus,
  actor: Actor,
  reason: { trigger: string; reasonCode?: string | null; note?: string | null },
  extra: { activatedAt?: Date } = {},
) {
  const m = await tx.merchant.findUnique({ where: { id: merchantId }, select: { id: true, status: true } });
  if (!m) throw new NotFoundError("Merchant");
  assertMerchantTransition(m.status, to);
  const updated = await tx.merchant.update({ where: { id: merchantId }, data: { status: to, ...extra } });
  await record(tx, actor, {
    action: "MERCHANT_STATUS_CHANGED",
    entityType: "Merchant",
    entityId: merchantId,
    before: { status: m.status },
    after: { status: to, ...reason },
  });
  return updated;
}

/** Apply a transition only if it is allowed from the current state; otherwise do nothing. */
export async function transitionMerchantIfAllowed(
  tx: Tx,
  merchantId: string,
  to: MerchantStatus,
  actor: Actor,
  reason: { trigger: string; reasonCode?: string | null; note?: string | null },
): Promise<boolean> {
  const m = await tx.merchant.findUnique({ where: { id: merchantId }, select: { status: true } });
  if (!m || !canTransitionMerchant(m.status, to)) return false;
  await transitionMerchant(tx, merchantId, to, actor, reason);
  return true;
}
