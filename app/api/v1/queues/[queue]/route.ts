import { db } from "@/lib/db";
import { json, route } from "@/lib/api";
import { QUEUES, caseWhere, applicationWhere, type QueueKey } from "@/lib/queries/queues";
import { NotFoundError } from "@/lib/errors";

/** GET /queues/:queue — items in a work queue (cases, alerts or applications). */
export const GET = route<{ queue: string }>({ cap: "case.read" }, async (_req, { params, user }) => {
  if (!(params.queue in QUEUES)) throw new NotFoundError("Queue");
  const q = params.queue as QueueKey;
  if (q === "alerts-untriaged") return json({ items: await db.alert.findMany({ where: { status: "OPEN" }, orderBy: { severity: "desc" } }) });
  const aw = applicationWhere(q);
  if (aw) return json({ items: await db.merchant.findMany({ where: aw, include: { applications: { take: 1, orderBy: { submittedAt: "desc" } } } }) });
  const items = await db.case.findMany({ where: (await caseWhere(q, user))!, orderBy: { slaDueAt: "asc" } });
  return json({ items });
});
