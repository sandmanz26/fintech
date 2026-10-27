import { db } from "@/lib/db";
import { json, route } from "@/lib/api";
import { simToday } from "@/lib/clock";
import { isoDay } from "@/lib/domain/reserves/calc";
import { NotFoundError } from "@/lib/errors";

/** Context the action drawers need: the merchant's name, today, and the reason codes. */
export const GET = route<{ id: string }>({ cap: "merchant.read" }, async (_req, { params }) => {
  const m = await db.merchant.findUnique({ where: { id: params.id }, select: { dbaName: true, legalName: true } });
  if (!m) throw new NotFoundError("Merchant");
  const reasons = await db.reasonCode.findMany({ where: { active: true }, orderBy: { code: "asc" } });
  return json({ merchantName: m.dbaName ?? m.legalName, today: isoDay(await simToday()), reasons });
});
