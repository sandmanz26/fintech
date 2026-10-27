import { z } from "zod";
import { db } from "@/lib/db";
import { record, type Actor } from "@/lib/domain/audit";
import { can, ForbiddenError } from "@/lib/auth/rbac";
import { DomainError, NotFoundError } from "@/lib/errors";
import { rescoreMerchant } from "@/lib/domain/scoring/service";

const minor = z.string().regex(/^\d+$/, "Minor units as a whole-number string").transform((s) => BigInt(s));

export const ProfileSchema = z.object({
  expectedMonthlyVolumeMinor: minor,
  expectedAvgTicketMinor: minor,
  avgDeliveryDays: z.number().int().min(0).max(365),
  note: z.string().trim().min(10, "Say what evidence supports the new profile (at least 10 characters)."),
});

/**
 * Update a processing merchant's declared profile (ROAST.md §3.2). Without this, a merchant that
 * legitimately grows trips R-VOL-OVER-PROFILE every week forever. The change is audited with
 * before and after, and the merchant is re-scored at once, because volume and delivery days are
 * scoring factors.
 */
export async function updateDeclaredProfile(actor: Actor & { id: string }, merchantId: string, raw: unknown) {
  if (!can(actor.role, "merchant.rescore")) throw new ForbiddenError();
  const input = ProfileSchema.parse(raw);
  if (input.expectedMonthlyVolumeMinor <= 0n || input.expectedAvgTicketMinor <= 0n) throw new DomainError("BAD_PROFILE", "Volume and average ticket must be above zero.");
  const m = await db.merchant.findUnique({ where: { id: merchantId } });
  if (!m) throw new NotFoundError("Merchant");
  const before = { expectedMonthlyVolumeMinor: m.expectedMonthlyVolumeMinor, expectedAvgTicketMinor: m.expectedAvgTicketMinor, avgDeliveryDays: m.avgDeliveryDays };
  const after = { expectedMonthlyVolumeMinor: input.expectedMonthlyVolumeMinor, expectedAvgTicketMinor: input.expectedAvgTicketMinor, avgDeliveryDays: input.avgDeliveryDays };
  if (before.expectedMonthlyVolumeMinor === after.expectedMonthlyVolumeMinor && before.expectedAvgTicketMinor === after.expectedAvgTicketMinor && before.avgDeliveryDays === after.avgDeliveryDays) {
    throw new DomainError("NO_CHANGE", "Nothing changed.");
  }
  await db.$transaction(async (tx) => {
    await tx.merchant.update({ where: { id: merchantId }, data: after });
    await record(tx, actor, { action: "MERCHANT_PROFILE_UPDATED", entityType: "Merchant", entityId: merchantId, before, after: { ...after, note: input.note } });
  });
  return rescoreMerchant(merchantId, "EVENT", actor);
}
