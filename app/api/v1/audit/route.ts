import { json, route, query } from "@/lib/api";
import { auditPage } from "@/lib/queries/audit";

/** GET /audit?entityType&entityId&actor&from&to — newest first, cursor paginated. */
export const GET = route({ cap: "audit.read" }, async (req) => {
  const q = query(req);
  return json(await auditPage(q, q.cursor, Math.min(100, Number(q.limit) || 50)));
});
