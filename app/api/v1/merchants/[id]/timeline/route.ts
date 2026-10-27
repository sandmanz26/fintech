import { json, route } from "@/lib/api";
import { merchantTimeline } from "@/lib/queries/merchant";

/** GET /merchants/:id/timeline — audit, case events, controls and alerts merged. */
export const GET = route<{ id: string }>({ cap: "merchant.read" }, async (_req, { params }) => json({ items: await merchantTimeline(params.id) }));
