import type { Role } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { jsonSafe } from "@/lib/money";
import { GENESIS_HASH, computeAuditHash, type VerifyResult } from "./hash";

export type Actor = { id: string | null; role: Role | null };
export const SYSTEM_ACTOR: Actor = { id: null, role: null };

export type AuditEntry = {
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
};

// One advisory-lock key serialises writers so the chain never forks.
const AUDIT_LOCK_KEY = 73_510_001;

/**
 * Append one row to the audit log. Must be called with the same transaction client
 * as the change it records, so the change and its audit row commit together.
 */
export async function record(tx: Tx, actor: Actor, entry: AuditEntry): Promise<void> {
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`);
  const last = await tx.auditLog.findFirst({ orderBy: { id: "desc" }, select: { hash: true } });
  const prevHash = last?.hash ?? GENESIS_HASH;
  const occurredAt = new Date();
  const before = entry.before === undefined ? null : jsonSafe(entry.before);
  const after = entry.after === undefined ? null : jsonSafe(entry.after);
  const hash = computeAuditHash({
    occurredAt,
    actorId: actor.id,
    actorRole: actor.role,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    before,
    after,
    prevHash,
  });
  await tx.auditLog.create({
    data: {
      occurredAt,
      actorId: actor.id,
      actorRole: actor.role,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: before as never,
      after: after as never,
      prevHash,
      hash,
    },
  });
}

/** Recompute the whole chain and report the first broken row. */
export async function verifyIntegrity(): Promise<VerifyResult> {
  const batch = 5000;
  let cursor: bigint | undefined;
  let prev = GENESIS_HASH;
  let checked = 0;
  for (;;) {
    const rows = await db.auditLog.findMany({
      orderBy: { id: "asc" },
      take: batch,
      ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;
    // Same algorithm as verifyChain, streamed in batches with `prev` carried across.
    for (const r of rows) {
      if (r.prevHash !== prev) return { ok: false, checked, firstBrokenId: r.id.toString(), reason: "chain_break" };
      const h = computeAuditHash({
        occurredAt: r.occurredAt,
        actorId: r.actorId,
        actorRole: r.actorRole,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        before: r.before,
        after: r.after,
        prevHash: r.prevHash,
      });
      if (h !== r.hash) return { ok: false, checked, firstBrokenId: r.id.toString(), reason: "hash_mismatch" };
      prev = r.hash;
      checked++;
    }
    cursor = rows[rows.length - 1].id;
    if (rows.length < batch) break;
  }
  return { ok: true, checked };
}
