import { createHash } from "node:crypto";

export const GENESIS_HASH = "0".repeat(64);

/** Deterministic JSON: object keys sorted recursively, BigInt as string, Dates as ISO. */
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(normalise(value));
}

function normalise(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(normalise);
  if (typeof v === "object") {
    // Prisma.Decimal and similar expose toJSON
    if (typeof (v as { toJSON?: unknown }).toJSON === "function" && !(v.constructor === Object)) {
      return normalise((v as { toJSON: () => unknown }).toJSON());
    }
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const val = (v as Record<string, unknown>)[k];
      if (val !== undefined) out[k] = normalise(val);
    }
    return out;
  }
  return v;
}

export type AuditHashInput = {
  occurredAt: Date;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  prevHash: string;
};

export function computeAuditHash(row: AuditHashInput): string {
  const body = canonicalJSON({
    occurredAt: row.occurredAt.toISOString(),
    actorId: row.actorId ?? null,
    actorRole: row.actorRole ?? null,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    before: row.before ?? null,
    after: row.after ?? null,
    prevHash: row.prevHash,
  });
  return createHash("sha256").update(row.prevHash + body).digest("hex");
}

export type VerifyResult =
  | { ok: true; checked: number }
  | { ok: false; checked: number; firstBrokenId: string; reason: "hash_mismatch" | "chain_break" };

/** Recompute a chain in id order. Pure, so it can be unit-tested without a database. */
export function verifyChain(rows: (AuditHashInput & { id: bigint | string; hash: string })[]): VerifyResult {
  let prev = GENESIS_HASH;
  let checked = 0;
  for (const r of rows) {
    if (r.prevHash !== prev) return { ok: false, checked, firstBrokenId: String(r.id), reason: "chain_break" };
    const h = computeAuditHash(r);
    if (h !== r.hash) return { ok: false, checked, firstBrokenId: String(r.id), reason: "hash_mismatch" };
    prev = r.hash;
    checked++;
  }
  return { ok: true, checked };
}
