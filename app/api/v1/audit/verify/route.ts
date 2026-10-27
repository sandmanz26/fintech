import { db } from "@/lib/db";
import { json, route, toActor } from "@/lib/api";
import { record, verifyIntegrity } from "@/lib/domain/audit";

/** POST /audit/verify — recompute the whole hash chain and report the first broken row. */
export const POST = route({ cap: "audit.verify" }, async (_req, { user }) => {
  const t0 = Date.now();
  const r = await verifyIntegrity();
  // The check itself is recorded after it runs, so it never verifies its own row.
  await db.$transaction((tx) => record(tx, toActor(user), { action: "AUDIT_VERIFIED", entityType: "AuditLog", entityId: "chain", after: r }));
  return json({ ...r, durationMs: Date.now() - t0 });
});
