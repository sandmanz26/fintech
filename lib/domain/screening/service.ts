import type { Owner, WatchlistHit } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { record, SYSTEM_ACTOR } from "@/lib/domain/audit";
import { adapters, nameSimilarity, type WatchlistMatch } from "@/lib/adapters";
import { addDays, isoDay, utcDay } from "@/lib/domain/reserves/calc";
import { raiseSystemAlert } from "@/lib/domain/rules/system";
import { PROCESSING_STATES } from "@/lib/domain/merchantStateMachine";

/**
 * Screening of owners against the vendor lists (sanctions, PEP, industry terminated list) and the
 * internal terminated list, at onboarding and on an ongoing basis (ROAST.md §2.1, §2.3).
 */

export const RESCREEN_INTERVAL_DAYS = 30;

const normaliseName = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

/**
 * Principals on the internal terminated list who match this owner: the same ID number, or a
 * similar name (the same 75/100 line as the vendor mock). An owner never matches the entries
 * written for their own merchant.
 */
export async function internalTerminatedMatches(tx: Tx, owner: Pick<Owner, "fullName" | "idNumber" | "merchantId">): Promise<WatchlistMatch[]> {
  // Spelled out: NOT (merchantId = x) would also drop entries with no merchant (NULL).
  const entries = await tx.terminatedListEntry.findMany({ where: { kind: "OWNER", OR: [{ merchantId: null }, { merchantId: { not: owner.merchantId } }] } });
  const out: WatchlistMatch[] = [];
  for (const e of entries) {
    const score = owner.idNumber && e.idNumber && owner.idNumber === e.idNumber ? 100 : nameSimilarity(owner.fullName, e.name);
    if (score >= 75) out.push({ listName: "TERMINATED_INTERNAL", matchedName: e.name, matchScore: score });
  }
  return out;
}

/** The merchant itself on the internal terminated list: same registration number or legal name. */
export async function merchantTerminatedEntry(tx: Tx, m: { id: string; registrationNo: string; legalName: string }) {
  const entries = await tx.terminatedListEntry.findMany({ where: { kind: "MERCHANT" } });
  return entries.find((e) => e.merchantId === m.id || e.registrationNo === m.registrationNo || normaliseName(e.name) === normaliseName(m.legalName)) ?? null;
}

const statusFrom = (hits: Pick<WatchlistHit, "status">[]) =>
  hits.some((h) => h.status === "CONFIRMED") ? "CONFIRMED_MATCH" : hits.some((h) => h.status === "PENDING_REVIEW") ? "POTENTIAL_MATCH" : "CLEAR";

/**
 * Screen one owner as of `asOf`. Creates a hit for each match not already on file (a reviewed
 * false positive is not raised again), then sets the owner's status from all their hits.
 */
export async function screenOwner(tx: Tx, owner: Owner, asOf: Date): Promise<WatchlistHit[]> {
  const [vendor, internal] = await Promise.all([
    adapters.watchlist.screen({ fullName: owner.fullName, dateOfBirth: owner.dateOfBirth, nationality: owner.nationality }, asOf),
    internalTerminatedMatches(tx, owner),
  ]);
  const existing = await tx.watchlistHit.findMany({ where: { ownerId: owner.id } });
  const created: WatchlistHit[] = [];
  for (const match of [...vendor, ...internal]) {
    if (existing.some((h) => h.listName === match.listName && h.matchedName === match.matchedName)) continue;
    created.push(await tx.watchlistHit.create({ data: { ownerId: owner.id, listName: match.listName, matchedName: match.matchedName, matchScore: match.matchScore, createdAt: asOf } }));
  }
  await tx.owner.update({
    where: { id: owner.id },
    data: { screeningStatus: statusFrom([...existing, ...created]), lastScreenedAt: asOf, screenedListVersion: adapters.watchlist.listVersion(asOf) },
  });
  return created;
}

/**
 * Ongoing screening (daily job): every owner of a processing merchant is screened again when a new
 * list version is published, and at least every RESCREEN_INTERVAL_DAYS. A new hit raises
 * R-WATCHLIST-RESCREEN, which opens or joins the merchant's watchlist case.
 */
export async function rescreenOwners(day: Date): Promise<{ screened: number; newHits: number; merchants: string[] }> {
  const d = utcDay(day);
  const version = adapters.watchlist.listVersion(d);
  const owners = await db.owner.findMany({
    where: {
      merchant: { status: { in: PROCESSING_STATES } },
      OR: [{ screenedListVersion: null }, { screenedListVersion: { not: version } }, { lastScreenedAt: null }, { lastScreenedAt: { lt: addDays(d, -RESCREEN_INTERVAL_DAYS) } }],
    },
  });
  let newHits = 0;
  const merchants = new Set<string>();
  for (const o of owners) {
    await db.$transaction(async (tx) => {
      const hits = await screenOwner(tx, o, d);
      for (const h of hits) {
        newHits++;
        merchants.add(o.merchantId);
        await record(tx, SYSTEM_ACTOR, { action: "WATCHLIST_HIT_FOUND", entityType: "WatchlistHit", entityId: h.id, after: { owner: o.fullName, listName: h.listName, matchedName: h.matchedName, listVersion: version } });
        await raiseSystemAlert(tx, {
          ruleKey: "R-WATCHLIST-RESCREEN",
          merchantId: o.merchantId,
          day: d,
          dedupeKey: `R-WATCHLIST-RESCREEN:${h.id}`,
          severity: h.listName === "SANCTIONS_MOCK" ? "CRITICAL" : "HIGH",
          evidence: { owner: o.fullName, ownerId: o.id, ownershipPct: Number(o.ownershipPct), listName: h.listName, matchedName: h.matchedName, matchScore: h.matchScore, listVersion: version, date: isoDay(d) },
        });
      }
    });
  }
  if (merchants.size) {
    const { rescoreMerchant } = await import("@/lib/domain/scoring/service");
    for (const id of merchants) await rescoreMerchant(id, "EVENT");
  }
  return { screened: owners.length, newHits, merchants: [...merchants] };
}
