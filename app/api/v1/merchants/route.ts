import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { json, page, pageParams, route } from "@/lib/api";

/** GET /merchants?status&band&mcc&assignee&q — cursor paginated. */
export const GET = route({ cap: "merchant.read" }, async (req) => {
  const { limit, cursor } = pageParams(req);
  const sp = req.nextUrl.searchParams;
  const where: Prisma.MerchantWhereInput = {};
  if (sp.get("status")) where.status = { in: sp.get("status")!.split(",") as never };
  if (sp.get("band")) where.currentBand = { in: sp.get("band")!.split(",") as never };
  if (sp.get("mcc")) where.mcc = sp.get("mcc")!;
  if (sp.get("assignee")) where.assignedToId = sp.get("assignee")!;
  if (sp.get("q")) {
    const q = sp.get("q")!;
    where.OR = [{ legalName: { contains: q, mode: "insensitive" } }, { dbaName: { contains: q, mode: "insensitive" } }, { registrationNo: { contains: q, mode: "insensitive" } }];
  }
  const rows = await db.merchant.findMany({
    where,
    orderBy: [{ currentScore: "desc" }, { id: "asc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, legalName: true, dbaName: true, status: true, currentBand: true, currentScore: true, mcc: true, country: true, expectedMonthlyVolumeMinor: true, currency: true },
  });
  return json(page(rows, limit));
});
