import { db } from "@/lib/db";
import { json, route } from "@/lib/api";

/** GET /reason-codes?category= — active codes for pickers. */
export const GET = route({ cap: "merchant.read" }, async (req) => {
  const category = req.nextUrl.searchParams.get("category") ?? undefined;
  return json({ items: await db.reasonCode.findMany({ where: { active: true, ...(category ? { category } : {}) }, orderBy: { code: "asc" } }) });
});
