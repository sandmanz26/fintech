import { describe, it, expect } from "vitest";
import { findingsFor, scanDue } from "@/lib/domain/monitoring/website";
import { hit } from "@/lib/rateLimit";
import { mockWatchlist, mockWebsite } from "@/lib/adapters";
import { listedFor } from "@/lib/domain/offboarding/categories";

describe("website monitoring", () => {
  it("an offline site is one finding, not four", () => {
    expect(findingsFor({ live: false, refundPolicy: false, terms: false, contact: false })).toEqual(["OFFLINE"]);
  });
  it("lists missing policies and restricted products", () => {
    expect(findingsFor({ live: true, refundPolicy: false, terms: true, contact: true, restricted: ["Prescription medicines"] })).toEqual(["MISSING_REFUND_POLICY", "RESTRICTED_PRODUCTS"]);
    expect(findingsFor({ live: true, refundPolicy: true, terms: true, contact: true })).toEqual([]);
  });
  it("scans weekly on a weekday fixed by the merchant, and at once if never scanned", () => {
    expect(scanDue("m1", new Date("2026-10-28T00:00:00Z"), null)).toBe(true);
    const due = Array.from({ length: 14 }, (_, i) => scanDue("m1", new Date(Date.UTC(2026, 10, 1 + i)), new Date("2026-10-01T00:00:00Z")));
    expect(due.filter(Boolean)).toHaveLength(2);
    expect(due.indexOf(true, due.indexOf(true) + 1) - due.indexOf(true)).toBe(7);
  });
  it("the mock crawler finds the scripted change only from its date", async () => {
    const before = await mockWebsite.scan("https://thistleflowerco14.example", new Date("2026-11-01T00:00:00Z"));
    const after = await mockWebsite.scan("https://thistleflowerco14.example", new Date("2026-11-02T00:00:00Z"));
    expect(findingsFor(before)).toEqual([]);
    expect(findingsFor(after)).toEqual(["MISSING_REFUND_POLICY", "RESTRICTED_PRODUCTS"]);
  });
});

describe("ongoing screening lists", () => {
  it("a designation counts only from the day it is published, and changes the list version", async () => {
    const oct = new Date("2026-10-31T00:00:00Z");
    const nov = new Date("2026-11-01T00:00:00Z");
    expect(await mockWatchlist.screen({ fullName: "Yusuf Gupta" }, oct)).toEqual([]);
    expect((await mockWatchlist.screen({ fullName: "Yusuf Gupta" }, nov))[0]).toMatchObject({ listName: "SANCTIONS_MOCK", matchScore: 100 });
    expect(mockWatchlist.listVersion(oct)).not.toBe(mockWatchlist.listVersion(nov));
  });
});

describe("terminated list", () => {
  it("the termination category decides listing", () => {
    expect(listedFor("FRAUD")).toBe(true);
    expect(listedFor("EXCESSIVE_CHARGEBACKS")).toBe(true);
    expect(listedFor("MERCHANT_REQUEST")).toBe(false);
    expect(listedFor("INACTIVE")).toBe(false);
  });
});

describe("portal rate limit", () => {
  it("allows the limit within a window, then refuses until it resets", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) expect(hit("k", 3, 60_000, t).ok).toBe(true);
    const r = hit("k", 3, 60_000, t + 1000);
    expect(r).toEqual({ ok: false, retryAfterS: 59 });
    expect(hit("k", 3, 60_000, t + 60_000).ok).toBe(true);
  });
});
