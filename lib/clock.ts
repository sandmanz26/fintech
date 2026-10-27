import { db, type Tx } from "@/lib/db";
import { utcDay, addDays, DAY_MS } from "@/lib/domain/reserves/calc";

/**
 * The demo runs on a simulated calendar so `npm run demo:advance-day` can move time forward.
 * now() = the simulated date at the current real UTC time of day. Everything time-sensitive
 * (SLA, review dates, releases) reads this, never `new Date()` directly.
 */

let cached: { today: Date; at: number } | null = null;

export async function simToday(tx: Tx = db): Promise<Date> {
  if (cached && Date.now() - cached.at < 2_000 && tx === db) return cached.today;
  const row = await tx.simClock.findUnique({ where: { id: 1 } });
  const today = row ? utcDay(row.today) : utcDay(new Date());
  if (tx === db) cached = { today, at: Date.now() };
  return today;
}

export async function now(tx: Tx = db): Promise<Date> {
  const today = await simToday(tx);
  const real = new Date();
  const msOfDay = real.getTime() - utcDay(real).getTime();
  return new Date(today.getTime() + msOfDay);
}

export async function setSimToday(day: Date, tx: Tx = db): Promise<void> {
  await tx.simClock.upsert({ where: { id: 1 }, create: { id: 1, today: utcDay(day) }, update: { today: utcDay(day) } });
  cached = null;
}

export async function advanceSimDay(tx: Tx = db): Promise<Date> {
  const next = addDays(await simToday(tx), 1);
  await setSimToday(next, tx);
  return next;
}

export function invalidateClock() {
  cached = null;
}

/** Add business days (Mon-Fri), used for the LOW-priority SLA. */
export function addBusinessDays(from: Date, n: number): Date {
  let d = new Date(from);
  let left = n;
  while (left > 0) {
    d = new Date(d.getTime() + DAY_MS);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d;
}
