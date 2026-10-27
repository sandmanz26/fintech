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

export type WatchlistMatch = { listName: "SANCTIONS_MOCK" | "TERMINATED_MERCHANT_MOCK" | "PEP_MOCK"; matchedName: string; matchScore: number };

export interface KybAdapter {
  verify(input: { legalName: string; registrationNo: string; country: string }): Promise<KybResult>;
}
export interface WebsiteCheckAdapter {
  check(url: string | null): Promise<WebsiteResult>;
}
export interface WatchlistAdapter {
  screen(input: { fullName: string; dateOfBirth?: Date | null; nationality?: string | null }): Promise<WatchlistMatch[]>;
}

// --- Mock data: fictional names only -----------------------------------------------------

/** Mock sanctions / PEP / terminated lists. Names are invented. */
export const MOCK_LISTS: { listName: WatchlistMatch["listName"]; name: string }[] = [
  { listName: "SANCTIONS_MOCK", name: "Viktor Halvorsen" },
  { listName: "SANCTIONS_MOCK", name: "Marek Dobrev" },
  { listName: "SANCTIONS_MOCK", name: "Oren Kasimov" },
  { listName: "PEP_MOCK", name: "Lucia Benedetti" },
  { listName: "PEP_MOCK", name: "Tomas Reinholt" },
  { listName: "TERMINATED_MERCHANT_MOCK", name: "Dario Kessling" },
  { listName: "TERMINATED_MERCHANT_MOCK", name: "Priya Halloran" },
];

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
  async screen({ fullName }) {
    const out: WatchlistMatch[] = [];
    for (const e of MOCK_LISTS) {
      const s = nameSimilarity(fullName, e.name);
      if (s >= 75) out.push({ listName: e.listName, matchedName: e.name, matchScore: s });
    }
    return out;
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
};

export const adapters = { kyb: mockKyb, website: mockWebsite, watchlist: mockWatchlist };
