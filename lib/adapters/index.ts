/**
 * Third-party checks behind interfaces (PRD §4.2). v1 ships deterministic mocks so demos are
 * repeatable; a real vendor adapter implements the same interface.
 */

export type KybResult = {
  provider: string;
  matched: boolean;
  registryName: string | null;
  registrationNo: string;
  status: "ACTIVE" | "DISSOLVED" | "NOT_FOUND";
  incorporatedAt: string | null;
  checkedAt: string;
  notes: string[];
};

export type WebsiteResult = {
  provider: string;
  url: string | null;
  live: boolean;
  refundPolicy: boolean;
  terms: boolean;
  contact: boolean;
  checkedAt: string;
};

export type WatchlistMatch = { listName: "SANCTIONS_MOCK" | "TERMINATED_MERCHANT_MOCK" | "PEP_MOCK" | "TERMINATED_INTERNAL"; matchedName: string; matchScore: number };

/** Ongoing monitoring of a live site (content, policies, restricted products). */
export type WebsiteScanResult = WebsiteResult & { categories: string[]; restricted: string[] };

export interface KybAdapter {
  verify(input: { legalName: string; registrationNo: string; country: string }): Promise<KybResult>;
}
export interface WebsiteCheckAdapter {
  check(url: string | null): Promise<WebsiteResult>;
  /** Re-crawl a live merchant's site as of a date (weekly monitoring). */
  scan(url: string, asOf: Date): Promise<WebsiteScanResult>;
}
export interface WatchlistAdapter {
  /** Screen against the lists as published on `asOf` (default: now). */
  screen(input: { fullName: string; dateOfBirth?: Date | null; nationality?: string | null }, asOf?: Date): Promise<WatchlistMatch[]>;
  /** Identifier of the list publication in force on `asOf`; a change means everyone is rescreened. */
  listVersion(asOf: Date): string;
}

// --- Mock data: fictional names only -----------------------------------------------------

/**
 * Mock sanctions / PEP / terminated lists. Names are invented. `listedFrom` dates a designation
 * published after the demo starts, so ongoing screening has something to find.
 */
export const MOCK_LISTS: { listName: WatchlistMatch["listName"]; name: string; listedFrom?: string }[] = [
  { listName: "SANCTIONS_MOCK", name: "Viktor Halvorsen" },
  { listName: "SANCTIONS_MOCK", name: "Marek Dobrev" },
  { listName: "SANCTIONS_MOCK", name: "Oren Kasimov" },
  { listName: "PEP_MOCK", name: "Lucia Benedetti" },
  { listName: "PEP_MOCK", name: "Tomas Reinholt" },
  { listName: "TERMINATED_MERCHANT_MOCK", name: "Dario Kessling" },
  { listName: "TERMINATED_MERCHANT_MOCK", name: "Priya Halloran" },
  // Designated on 1 Nov 2026; owns Beacon Consulting, an active LOW merchant in the seed.
  { listName: "SANCTIONS_MOCK", name: "Yusuf Gupta", listedFrom: "2026-11-01" },
];

const listedBy = (asOf: Date) => {
  const d = asOf.toISOString().slice(0, 10);
  return MOCK_LISTS.filter((e) => !e.listedFrom || e.listedFrom <= d);
};

function normalise(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
}

/** Token-overlap similarity (0-100), deterministic. */
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(normalise(a).split(" "));
  const tb = new Set(normalise(b).split(" "));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  // Partial credit for same surname prefix (typos, transliteration).
  const la = [...ta].at(-1) ?? "";
  const lb = [...tb].at(-1) ?? "";
  const prefix = la.slice(0, 4) === lb.slice(0, 4) && la !== lb ? 0.5 : 0;
  return Math.round((100 * (shared + prefix)) / Math.max(ta.size, tb.size));
}

export const mockWatchlist: WatchlistAdapter = {
  async screen({ fullName }, asOf = new Date()) {
    const out: WatchlistMatch[] = [];
    for (const e of listedBy(asOf)) {
      const s = nameSimilarity(fullName, e.name);
      if (s >= 75) out.push({ listName: e.listName, matchedName: e.name, matchScore: s });
    }
    return out;
  },
  listVersion(asOf) {
    const dated = listedBy(asOf).flatMap((e) => (e.listedFrom ? [e.listedFrom] : [])).sort();
    return `mock-lists@${dated.at(-1) ?? "base"}`;
  },
};

export const mockKyb: KybAdapter = {
  async verify({ legalName, registrationNo }) {
    // Convention for demos: registration numbers ending in "000" are not found in the registry.
    const notFound = registrationNo.endsWith("000");
    return {
      provider: "mock-registry",
      matched: !notFound,
      registryName: notFound ? null : legalName,
      registrationNo,
      status: notFound ? "NOT_FOUND" : "ACTIVE",
      incorporatedAt: null,
      checkedAt: new Date().toISOString(),
      notes: notFound ? ["No company with this registration number in the registry."] : [],
    };
  },
};

export const mockWebsite: WebsiteCheckAdapter = {
  async check(url) {
    const u = (url ?? "").toLowerCase();
    // Deterministic: the host name decides what is "found" on the site.
    const live = !!u && !u.includes("offline");
    return {
      provider: "mock-crawler",
      url,
      live,
      refundPolicy: live && !u.includes("norefund"),
      terms: live && !u.includes("noterms"),
      contact: live && !u.includes("nocontact"),
      checkedAt: new Date().toISOString(),
    };
  },
  async scan(url, asOf) {
    const base = await mockWebsite.check(url);
    const host = url.toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
    const d = asOf.toISOString().slice(0, 10);
    const change = MOCK_SITE_CHANGES.filter((c) => c.host === host && c.from <= d).at(-1);
    return {
      ...base,
      ...(change?.patch ?? {}),
      checkedAt: asOf.toISOString(),
      categories: change?.categories ?? [],
      restricted: change?.restricted ?? [],
    };
  },
};

/** Dated changes the mock crawler "finds" on otherwise unchanged sites (fictional hosts). */
export const MOCK_SITE_CHANGES: { host: string; from: string; categories: string[]; restricted: string[]; patch?: Partial<WebsiteResult> }[] = [
  // A florist that starts selling prescription-only products and drops its refund policy.
  { host: "thistleflowerco14.example", from: "2026-11-02", categories: ["Flowers", "Gifts", "Pharmacy"], restricted: ["Prescription medicines"], patch: { refundPolicy: false } },
];

export const adapters = { kyb: mockKyb, website: mockWebsite, watchlist: mockWatchlist };
