import { z } from "zod";
import { db } from "@/lib/db";
import { body, json, route } from "@/lib/api";

/** Marks the caller's own (or their role's) notifications read. */
export const POST = route({ cap: "merchant.read" }, async (req, { user }) => {
  const { ids } = await body(req, z.object({ ids: z.array(z.string()).max(200) }));
  const r = await db.notification.updateMany({ where: { id: { in: ids }, readAt: null, OR: [{ userId: user.id }, { role: user.role, userId: null }] }, data: { readAt: new Date() } });
  return json({ updated: r.count });
});
