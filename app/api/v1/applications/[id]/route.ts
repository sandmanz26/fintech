import { db } from "@/lib/db";
import { json, route } from "@/lib/api";
import { NotFoundError } from "@/lib/errors";
import { missingItems, type Checklist } from "@/lib/domain/underwriting/checklist";

/** GET /applications/:id — application, checklist, adapter results and what still blocks a decision. */
export const GET = route<{ id: string }>({ cap: "merchant.read" }, async (_req, { params }) => {
  const app = await db.application.findUnique({ where: { id: params.id }, include: { merchant: true } });
  if (!app) throw new NotFoundError("Application");
  return json({ ...app, missing: missingItems(app.checklist as unknown as Checklist).map((i) => i.key) });
});
