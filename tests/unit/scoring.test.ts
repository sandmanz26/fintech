import { describe, it, expect } from "vitest";
import { scoreMerchant, bandFor, monthsBetween, mccTier, type ScoringInput } from "@/lib/domain/scoring";
import { DEFAULT_POLICY } from "@/lib/domain/policy/defaults";
import type { PolicyParams } from "@/lib/domain/policy/types";

const asOf = new Date("2026-10-27T00:00:00Z");

function base(over: Partial<ScoringInput> = {}): ScoringInput {
  return {
    asOf,
    mcc: "5411",
    country: "US",
    incorporatedAt: new Date("2020-01-15T00:00:00Z"),
    deliveryModel: "IMMEDIATE",
    avgDeliveryDays: 0,
    expectedMonthlyVolumeMinor: 2_000_000n,
    expectedAvgTicketMinor: 4_000n,
    currency: "USD",
    priorCbRatioBps: null,
    website: { live: true, refundPolicy: true, terms: true, contact: true },
    owners: [{ fullName: "Ana Ortiz", screeningStatus: "CLEAR", hits: [] }],
    merchantOnTerminatedList: false,
    ...over,
  };
}

const f = (input: ScoringInput, key: string) => {
  const r = scoreMerchant(input, DEFAULT_POLICY, 1);
  const factor = r.factors.find((x) => x.key === key);
  if (!factor) throw new Error(`missing factor ${key}`);
  return factor;
};

describe("scoreMerchant", () => {
  it("scores a clean grocery store at zero, LOW, with all ten factors", () => {
    const r = scoreMerchant(base(), DEFAULT_POLICY, 1);
    expect(r.score).toBe(0);
    expect(r.band).toBe("LOW");
    expect(r.factors.map((x) => x.key)).toEqual([
      "mcc_tier",
      "business_age",
      "delivery_model",
      "delivery_days",
      "ticket_size",
      "volume_vs_age",
      "cross_border",
      "prior_cb_ratio",
      "website_gaps",
      "screening_potential",
    ]);
    expect(r.hardStops).toEqual([]);
    expect(r.policyVersion).toBe(1);
  });

  it("is pure: same input, same output", () => {
    expect(scoreMerchant(base(), DEFAULT_POLICY, 1)).toEqual(scoreMerchant(base(), DEFAULT_POLICY, 1));
  });

  it("score equals the sum of factor points", () => {
    const r = scoreMerchant(base({ mcc: "4722", deliveryModel: "FUTURE_SERVICE", avgDeliveryDays: 45 }), DEFAULT_POLICY, 1);
    expect(r.score).toBe(r.factors.reduce((s, x) => s + x.points, 0));
  });

  describe("mcc_tier", () => {
    it("standard 0, elevated 10, high 20", () => {
      expect(f(base({ mcc: "5411" }), "mcc_tier").points).toBe(0);
      expect(f(base({ mcc: "5732" }), "mcc_tier").points).toBe(10);
      expect(f(base({ mcc: "4722" }), "mcc_tier").points).toBe(20);
      expect(f(base({ mcc: "4722" }), "mcc_tier").maxPoints).toBe(20);
      expect(f(base({ mcc: "4722" }), "mcc_tier").explanation).toContain("Travel agencies");
    });
    it("names an unknown MCC by its code", () => {
      expect(f(base({ mcc: "1234" }), "mcc_tier").explanation).toContain("MCC 1234");
    });
  });

  describe("business_age", () => {
    it("< 6 months: 12", () => {
      const x = f(base({ incorporatedAt: new Date("2026-06-20T00:00:00Z") }), "business_age");
      expect(x.points).toBe(12);
      expect(x.explanation).toBe("Business is 4 months old (under 6 months) -> +12");
    });
    it("6-24 months: 6 (boundaries inclusive)", () => {
      expect(f(base({ incorporatedAt: new Date("2026-04-27T00:00:00Z") }), "business_age").points).toBe(6);
      expect(f(base({ incorporatedAt: new Date("2024-10-27T00:00:00Z") }), "business_age").points).toBe(6);
    });
    it("> 24 months: 0", () => {
      expect(f(base({ incorporatedAt: new Date("2024-09-01T00:00:00Z") }), "business_age").points).toBe(0);
    });
    it("missing incorporation date is treated as new", () => {
      const x = f(base({ incorporatedAt: null }), "business_age");
      expect(x.points).toBe(12);
      expect(x.input).toBeNull();
    });
  });

  it("delivery_model points per model", () => {
    expect(f(base({ deliveryModel: "IMMEDIATE" }), "delivery_model").points).toBe(0);
    expect(f(base({ deliveryModel: "DIGITAL" }), "delivery_model").points).toBe(3);
    expect(f(base({ deliveryModel: "SHIPPED" }), "delivery_model").points).toBe(6);
    expect(f(base({ deliveryModel: "SUBSCRIPTION" }), "delivery_model").points).toBe(8);
    expect(f(base({ deliveryModel: "FUTURE_SERVICE" }), "delivery_model").points).toBe(12);
    expect(f(base(), "delivery_model").maxPoints).toBe(12);
  });

  it("delivery_days: 0-7 -> 0, 8-30 -> 5, > 30 -> 10", () => {
    expect(f(base({ avgDeliveryDays: 7 }), "delivery_days").points).toBe(0);
    expect(f(base({ avgDeliveryDays: 8 }), "delivery_days").points).toBe(5);
    expect(f(base({ avgDeliveryDays: 30 }), "delivery_days").points).toBe(5);
    expect(f(base({ avgDeliveryDays: 31 }), "delivery_days").points).toBe(10);
    expect(f(base({ avgDeliveryDays: 1 }), "delivery_days").explanation).toContain("1 day ");
  });

  it("ticket_size: above the MCC's p90 -> 8, otherwise 0; falls back to the default p90", () => {
    expect(f(base({ mcc: "5411", expectedAvgTicketMinor: 15_001n }), "ticket_size").points).toBe(8);
    expect(f(base({ mcc: "5411", expectedAvgTicketMinor: 15_000n }), "ticket_size").points).toBe(0);
    expect(f(base({ mcc: "5999", expectedAvgTicketMinor: 25_001n }), "ticket_size").points).toBe(8);
    expect(f(base({ mcc: "5999", expectedAvgTicketMinor: 25_001n }), "ticket_size").explanation).toContain("$250.00");
  });

  it("volume_vs_age: young and above threshold -> 10", () => {
    const young = new Date("2026-03-01T00:00:00Z");
    expect(f(base({ incorporatedAt: young, expectedMonthlyVolumeMinor: 10_000_001n }), "volume_vs_age").points).toBe(10);
    expect(f(base({ incorporatedAt: young, expectedMonthlyVolumeMinor: 10_000_000n }), "volume_vs_age").points).toBe(0);
    expect(f(base({ expectedMonthlyVolumeMinor: 99_000_000n }), "volume_vs_age").points).toBe(0);
    expect(f(base({ expectedMonthlyVolumeMinor: 99_000_000n }), "volume_vs_age").explanation).toContain("over 12 months");
    expect(f(base({ incorporatedAt: null, expectedMonthlyVolumeMinor: 99_000_000n }), "volume_vs_age").points).toBe(10);
  });

  it("cross_border: outside the primary region -> 6", () => {
    expect(f(base({ country: "US" }), "cross_border").points).toBe(0);
    expect(f(base({ country: "MT" }), "cross_border").points).toBe(6);
  });

  it("prior_cb_ratio: > 0.9% -> 12; 0.5-0.9% -> 6; below or none -> 0", () => {
    expect(f(base({ priorCbRatioBps: 91 }), "prior_cb_ratio").points).toBe(12);
    expect(f(base({ priorCbRatioBps: 90 }), "prior_cb_ratio").points).toBe(6);
    expect(f(base({ priorCbRatioBps: 50 }), "prior_cb_ratio").points).toBe(6);
    expect(f(base({ priorCbRatioBps: 49 }), "prior_cb_ratio").points).toBe(0);
    expect(f(base({ priorCbRatioBps: null }), "prior_cb_ratio").explanation).toContain("No prior");
    expect(f(base({ priorCbRatioBps: 120 }), "prior_cb_ratio").explanation).toContain("1.20%");
  });

  it("website_gaps: 2 per missing policy, max 6; offline counts as all missing; no site -> 0", () => {
    expect(f(base({ website: { live: true, refundPolicy: false, terms: true, contact: true } }), "website_gaps").points).toBe(2);
    expect(f(base({ website: { live: true, refundPolicy: false, terms: false, contact: false } }), "website_gaps").points).toBe(6);
    expect(f(base({ website: { live: false, refundPolicy: true, terms: true, contact: true } }), "website_gaps").points).toBe(6);
    expect(f(base({ website: null }), "website_gaps").points).toBe(0);
    expect(f(base({ website: null }), "website_gaps").explanation).toContain("card-present");
  });

  it("screening_potential: any unreviewed hit -> 4", () => {
    expect(f(base({ owners: [{ fullName: "A", screeningStatus: "POTENTIAL_MATCH", hits: [] }] }), "screening_potential").points).toBe(4);
    expect(
      f(base({ owners: [{ fullName: "A", screeningStatus: "CLEAR", hits: [{ listName: "PEP_MOCK", status: "PENDING_REVIEW" }] }] }), "screening_potential").points,
    ).toBe(4);
    expect(
      f(base({ owners: [{ fullName: "A", screeningStatus: "CLEAR", hits: [{ listName: "PEP_MOCK", status: "FALSE_POSITIVE" }] }] }), "screening_potential").points,
    ).toBe(0);
  });

  describe("hard stops force PROHIBITED", () => {
    it("prohibited MCC", () => {
      const r = scoreMerchant(base({ mcc: "7995" }), DEFAULT_POLICY, 1);
      expect(r.band).toBe("PROHIBITED");
      expect(r.hardStops.map((h) => h.key)).toEqual(["prohibited_mcc"]);
      expect(mccTier("7995", DEFAULT_POLICY)).toBe("prohibited");
    });
    it("owner with a confirmed watchlist hit", () => {
      const r = scoreMerchant(
        base({ owners: [{ fullName: "B", screeningStatus: "CONFIRMED_MATCH", hits: [{ listName: "SANCTIONS_MOCK", status: "CONFIRMED" }] }] }),
        DEFAULT_POLICY,
        1,
      );
      expect(r.band).toBe("PROHIBITED");
      expect(r.hardStops.map((h) => h.key)).toEqual(["confirmed_watchlist"]);
    });
    it("owner status CONFIRMED_MATCH without hit rows still stops", () => {
      const r = scoreMerchant(base({ owners: [{ fullName: "B", screeningStatus: "CONFIRMED_MATCH", hits: [] }] }), DEFAULT_POLICY, 1);
      expect(r.hardStops.map((h) => h.key)).toEqual(["confirmed_watchlist"]);
    });
    it("owner on the terminated list", () => {
      const r = scoreMerchant(
        base({ owners: [{ fullName: "C", screeningStatus: "CONFIRMED_MATCH", hits: [{ listName: "TERMINATED_MERCHANT_MOCK", status: "CONFIRMED" }] }] }),
        DEFAULT_POLICY,
        1,
      );
      expect(r.hardStops.map((h) => h.key)).toEqual(["terminated_list_owner"]);
    });
    it("merchant on the terminated list", () => {
      const r = scoreMerchant(base({ merchantOnTerminatedList: true }), DEFAULT_POLICY, 1);
      expect(r.band).toBe("PROHIBITED");
      expect(r.hardStops.map((h) => h.key)).toEqual(["terminated_list_merchant"]);
    });
    it("keeps the arithmetic score alongside the hard stop", () => {
      const r = scoreMerchant(base({ mcc: "7995", country: "MT" }), DEFAULT_POLICY, 1);
      expect(r.score).toBe(6);
    });
  });

  it("story S1: Lumen Travel scores HIGH", () => {
    const r = scoreMerchant(
      base({
        mcc: "4722",
        incorporatedAt: new Date("2026-06-20T00:00:00Z"),
        deliveryModel: "FUTURE_SERVICE",
        avgDeliveryDays: 45,
        expectedMonthlyVolumeMinor: 3_750_000_00n / 10n,
        expectedAvgTicketMinor: 85_000n,
      }),
      DEFAULT_POLICY,
      1,
    );
    expect(r.band).toBe("HIGH");
    expect(r.score).toBe(20 + 12 + 12 + 10 + 10);
  });

  it("clamps to 100", () => {
    const heavy: PolicyParams = structuredClone(DEFAULT_POLICY);
    heavy.scoring.points.mcc.high = 90;
    const r = scoreMerchant(base({ mcc: "4722", country: "MT" }), heavy, 2);
    expect(r.score).toBe(96);
    heavy.scoring.points.crossBorder = 50;
    expect(scoreMerchant(base({ mcc: "4722", country: "MT" }), heavy, 2).score).toBe(100);
  });
});

describe("bandFor", () => {
  it("uses policy thresholds: 0-29 LOW, 30-54 MEDIUM, 55+ HIGH", () => {
    expect(bandFor(29, DEFAULT_POLICY)).toBe("LOW");
    expect(bandFor(30, DEFAULT_POLICY)).toBe("MEDIUM");
    expect(bandFor(54, DEFAULT_POLICY)).toBe("MEDIUM");
    expect(bandFor(55, DEFAULT_POLICY)).toBe("HIGH");
  });
  it("a policy change moves the band without code changes", () => {
    const p: PolicyParams = structuredClone(DEFAULT_POLICY);
    p.scoring.bands.highFrom = 40;
    expect(bandFor(45, p)).toBe("HIGH");
  });
});

describe("monthsBetween", () => {
  it("counts whole months", () => {
    expect(monthsBetween(new Date("2026-01-31Z"), new Date("2026-02-28Z"))).toBe(0);
    expect(monthsBetween(new Date("2026-01-15Z"), new Date("2026-03-15Z"))).toBe(2);
  });
});
