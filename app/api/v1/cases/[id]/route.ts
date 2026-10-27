import { db } from "@/lib/db";
import { json, route } from "@/lib/api";
import { NotFoundError } from "@/lib/errors";

/** GET /cases/:id — case, linked alerts and events. */
export const GET = route<{ id: string }>({ cap: "case.read" }, async (_req, { params }) => {
  const c = await db.case.findUnique({ where: { id: params.id }, include: { alerts: true, events: { orderBy: { createdAt: "asc" } }, merchant: { select: { id: true, legalName: true, dbaName: true, status: true, currentBand: true } } } });
  if (!c) throw new NotFoundError("Case");
  return json(c);
});
