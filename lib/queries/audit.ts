import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export type AuditFilter = { entityType?: string; entityId?: string; actor?: string; action?: string; from?: string; to?: string };

export function auditWhere(f: AuditFilter): Prisma.AuditLogWhereInput {
  const w: Prisma.AuditLogWhereInput = {};
  if (f.entityType) w.entityType = f.entityType;
  if (f.entityId) w.entityId = f.entityId;
  if (f.actor) w.actorId = f.actor === "system" ? null : f.actor;
  if (f.action) w.action = { contains: f.action.toUpperCase() };
  if (f.from || f.to) w.occurredAt = { ...(f.from ? { gte: new Date(`${f.from}T00:00:00Z`) } : {}), ...(f.to ? { lte: new Date(`${f.to}T23:59:59Z`) } : {}) };
  return w;
}

export async function auditPage(f: AuditFilter, cursor?: string, take = 50) {
  const rows = await db.auditLog.findMany({
    where: auditWhere(f),
    orderBy: { id: "desc" },
    take: take + 1,
    ...(cursor ? { cursor: { id: BigInt(cursor) }, skip: 1 } : {}),
  });
  return { items: rows.slice(0, take), nextCursor: rows.length > take ? rows[take - 1].id.toString() : null };
}
