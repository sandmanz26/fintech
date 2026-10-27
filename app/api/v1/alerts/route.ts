import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { json, page, pageParams, route } from "@/lib/api";

/** GET /alerts?status&severity&ruleKey */
export const GET = route({ cap: "case.read" }, async (req) => {
  const sp = req.nextUrl.searchParams;
  const { limit, cursor } = pageParams(req);
  const where: Prisma.AlertWhereInput = {};
  if (sp.get("status")) where.status = sp.get("status")!;
  if (sp.get("severity")) where.severity = sp.get("severity") as never;
  if (sp.get("ruleKey")) where.ruleKey = sp.get("ruleKey")!;
  const rows = await db.alert.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
  return json(page(rows, limit));
});
