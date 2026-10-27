import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { rescreenOwners, screenOwner } from "@/lib/domain/screening/service";
import { monitorWebsites } from "@/lib/domain/monitoring/website";
import { addDays } from "@/lib/domain/reserves/calc";

/**
 * ROAST.md §2-3: screening and website checks keep running after onboarding, and the internal
 * terminated list is read for principals. Assertions are on resulting state, so the file passes
 * whether or not the 30-day preview test has already moved the calendar past these dates.
 */
describe("ongoing monitoring", () => {
  it("a designation published on 1 Nov is found on the active merchant's owner, once", async () => {
    await rescreenOwners(new Date("2026-11-01T00:00:00Z"));
    const owner = await db.owner.findFirstOrThrow({ where: { fullName: "Yusuf Gupta" }, include: { hits: true, merchant: true } });
    expect(owner.hits.map((h) => h.listName)).toContain("SANCTIONS_MOCK");
    expect(owner.screeningStatus).toBe("POTENTIAL_MATCH");
    const alerts = await db.alert.findMany({ where: { merchantId: owner.merchantId, ruleKey: "R-WATCHLIST-RESCREEN" } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("CRITICAL");
    expect(alerts[0].caseId).not.toBeNull();
    const c = await db.case.findUniqueOrThrow({ where: { id: alerts[0].caseId! } });
    expect(c.type).toBe("WATCHLIST");
    // Same list version, screened today: nothing to do, nothing raised twice.
    const again = await rescreenOwners(new Date("2026-11-01T00:00:00Z"));
    expect(again.newHits).toBe(0);
  });

  it("the florist's new prescription products are found within a week and raise one alert", async () => {
    const m = await db.merchant.findFirstOrThrow({ where: { dbaName: "Thistle Flower Co." } });
    for (let d = new Date("2026-11-02T00:00:00Z"), i = 0; i < 7; i++, d = addDays(d, 1)) await monitorWebsites(d);
    const alerts = await db.alert.findMany({ where: { merchantId: m.id, ruleKey: "R-WEBSITE-CHANGE" } });
    expect(alerts).toHaveLength(1);
    expect(JSON.stringify(alerts[0].evidence)).toContain("Restricted products on sale");
    expect(JSON.stringify(alerts[0].evidence)).toContain("Refund policy removed");
    const last = await db.websiteScan.findFirstOrThrow({ where: { merchantId: m.id }, orderBy: { scannedAt: "desc" } });
    expect(last.findings).toContain("RESTRICTED_PRODUCTS");
  });

  it("a principal of a terminated merchant is caught at the next onboarding by ID number", async () => {
    await db.terminatedListEntry.create({ data: { kind: "OWNER", name: "Ines Varga", idNumber: "P-4471902", reasonCode: "TR-FRAUD", merchantId: null, addedById: "system" } });
    const fresh = await db.merchant.create({
      data: {
        legalName: "Varga Trading LLC",
        registrationNo: "US-ITG-99001",
        country: "US",
        mcc: "5999",
        deliveryModel: "SHIPPED",
        expectedMonthlyVolumeMinor: 1_000_000n,
        expectedAvgTicketMinor: 5_000n,
        owners: { create: { fullName: "Inés Várga-Lind", idNumber: "P-4471902", ownershipPct: 100 } },
      },
      include: { owners: true },
    });
    const hits = await db.$transaction((tx) => screenOwner(tx, fresh.owners[0], new Date("2026-11-03T00:00:00Z")));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ listName: "TERMINATED_INTERNAL", matchScore: 100, status: "PENDING_REVIEW" });
  });
});
