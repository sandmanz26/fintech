import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { route, query, toActor } from "@/lib/api";
import { auditWhere } from "@/lib/queries/audit";
import { toCsv } from "@/lib/csv";
import { record } from "@/lib/domain/audit";

/** GET /audit/export — the filtered log as CSV, hashes included so an auditor can re-verify offline. */
export const GET = route({ cap: "audit.read" }, async (req, { user }) => {
  const f = query(req);
  const rows = await db.auditLog.findMany({ where: auditWhere(f), orderBy: { id: "asc" }, take: 50_000 });
  const csv = toCsv(
    ["id", "occurred_at", "actor_id", "actor_role", "action", "entity_type", "entity_id", "before", "after", "prev_hash", "hash"],
    rows.map((r) => [r.id, r.occurredAt.toISOString(), r.actorId, r.actorRole, r.action, r.entityType, r.entityId, r.before ? JSON.stringify(r.before) : "", r.after ? JSON.stringify(r.after) : "", r.prevHash, r.hash]),
  );
  await db.$transaction((tx) => record(tx, toActor(user), { action: "AUDIT_EXPORTED", entityType: "AuditLog", entityId: "export", after: { filter: f, rows: rows.length } }));
  return new NextResponse(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="sentinel-audit.csv"', "cache-control": "no-store" } });
});
