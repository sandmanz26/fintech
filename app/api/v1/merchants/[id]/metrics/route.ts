import { db } from "@/lib/db";
import { json, route } from "@/lib/api";
import { utcDay } from "@/lib/domain/reserves/calc";

/** GET /merchants/:id/metrics?from&to — DailyMerchantMetric series. */
export const GET = route<{ id: string }>({ cap: "merchant.read" }, async (req, { params }) => {
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from") ? utcDay(new Date(sp.get("from")!)) : undefined;
  const to = sp.get("to") ? utcDay(new Date(sp.get("to")!)) : undefined;
  const rows = await db.dailyMerchantMetric.findMany({
    where: { merchantId: params.id, date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } },
    orderBy: { date: "asc" },
  });
  return json({ items: rows });
});
