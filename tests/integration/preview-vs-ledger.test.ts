import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/lib/db";
import { advanceOneDay } from "@/lib/jobs";
import { simToday } from "@/lib/clock";
import { createControl, previewControl, reserveBalances } from "@/lib/domain/controls/service";
import { simulate, isoDay, addDays } from "@/lib/domain/reserves/calc";

/**
 * PRD §12 F7: "the preview matches the real result after 30× demo:advance-day".
 * The preview projects the last 30 days of volume forward; reality has its own volume. So we check
 * two things: (1) the ledger equals the same simulation fed with the volume that actually
 * happened (same code path, exact to the cent); (2) the projection was close to reality.
 */
describe("impact preview vs reserve ledger after 30 days", () => {
  let merchantId: string;
  let controlId: string;
  let projected: { endBalance: string; days: { balance: string }[] };
  let start: Date;
  const params = { pctBps: 500, holdDays: 20 };

  beforeAll(async () => {
    // A steady, low-risk merchant with no controls: the clearest case for a projection.
    const candidates = await db.merchant.findMany({ where: { status: "ACTIVE", currentBand: "LOW", controls: { none: {} } }, select: { id: true } });
    start = await simToday();
    let best = { id: "", vol: 0n };
    for (const c of candidates) {
      const a = await db.dailyMerchantMetric.aggregate({ where: { merchantId: c.id, date: { gte: addDays(start, -30), lt: start } }, _sum: { grossVolumeMinor: true } });
      if ((a._sum.grossVolumeMinor ?? 0n) > best.vol) best = { id: c.id, vol: a._sum.grossVolumeMinor ?? 0n };
    }
    merchantId = best.id;
    const pv = await previewControl({ merchantId, type: "ROLLING_RESERVE", params, effectiveFrom: isoDay(start) });
    projected = pv.after;
    const dimas = await db.user.findFirstOrThrow({ where: { role: "SENIOR_ANALYST" } });
    const r = await createControl({ id: dimas.id, role: dimas.role }, { merchantId, type: "ROLLING_RESERVE", params, reasonCode: "CT-NEW-MERCHANT", note: "Integration test reserve.", reviewAt: isoDay(addDays(start, 60)), effectiveFrom: isoDay(start) });
    controlId = r.control.id;
    expect(r.control.status).toBe("ACTIVE");
    for (let i = 0; i < 30; i++) await advanceOneDay();
  }, 300_000);

  it("ledger balance equals the simulation on actual volume, to the cent", async () => {
    const days = await db.dailyMerchantMetric.findMany({ where: { merchantId, date: { gte: start, lt: addDays(start, 30) } }, orderBy: { date: "asc" } });
    expect(days).toHaveLength(30);
    const sim = simulate({
      start,
      days: 30,
      dailySettled: days.map((d) => d.grossVolumeMinor),
      controls: [{ id: controlId, type: "ROLLING_RESERVE", params, effectiveFrom: start }],
      opening: {},
      pending: [],
    });
    const { total } = await reserveBalances(merchantId);
    // Releases due on day 30 run in the morning job of day 31; compare against the simulation's
    // balance after day 30's hold plus the morning release of day 31.
    const releaseDay31 = sim.days.filter((d, i) => i + 20 === 30).reduce((a, d) => a + d.hold, 0n);
    expect(total).toBe(sim.endBalance - releaseDay31);
  });

  it("the projection was within 15% of reality", async () => {
    const { total } = await reserveBalances(merchantId);
    const proj = BigInt(projected.days[29].balance);
    const diff = Number(total > proj ? total - proj : proj - total) / Number(proj);
    expect(diff).toBeLessThan(0.15);
  });
});
