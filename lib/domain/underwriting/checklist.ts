import type { RiskBand } from "@prisma/client";

/** Due-diligence checklist (PRD §6.1). Pure helpers; the service persists it as Application.checklist. */

export type ChecklistStatus = "PENDING" | "PASS" | "FAIL" | "WAIVED";
export type ChecklistItem = {
  key: string;
  label: string;
  source: string;
  required: boolean;
  status: ChecklistStatus;
  auto: boolean;
  evidence?: string | null;
  note?: string | null;
  updatedById?: string | null;
  updatedAt?: string | null;
};
export type Checklist = { items: ChecklistItem[] };

export const CHECKLIST_DEFS: { key: string; label: string; source: string; bands: RiskBand[] | "all" | "online" }[] = [
  { key: "kyb_registry", label: "Business registration matches", source: "Registry check", bands: "all" },
  { key: "ubo_complete", label: "Owners cover 75% or a controller is named", source: "Ownership", bands: "all" },
  { key: "screening_clear", label: "No unreviewed or confirmed watchlist hits", source: "Watchlist screening", bands: "all" },
  { key: "website_policies", label: "Site live with refund policy and terms", source: "Website check", bands: "online" },
  { key: "bank_statement", label: "Three months of bank statements accepted", source: "Documents", bands: ["MEDIUM", "HIGH"] },
  { key: "processing_history", label: "Previous processing statements reviewed", source: "Documents", bands: ["HIGH"] },
  { key: "exposure_review", label: "Exposure calculated and controls proposed", source: "Exposure calculator", bands: ["HIGH"] },
];

export function isRequired(def: (typeof CHECKLIST_DEFS)[number], band: RiskBand | null, online: boolean): boolean {
  if (def.bands === "all") return true;
  if (def.bands === "online") return online;
  // Prohibited applications are reviewed as HIGH if an override is requested.
  const b = band === "PROHIBITED" ? "HIGH" : band;
  return !!b && def.bands.includes(b);
}

/** Rebuild the checklist for a band, keeping manual statuses already set. */
export function buildChecklist(prev: Checklist | null, band: RiskBand | null, online: boolean, auto: Partial<Record<string, { status: ChecklistStatus; evidence: string }>>): Checklist {
  const prevBy = new Map((prev?.items ?? []).map((i) => [i.key, i]));
  return {
    items: CHECKLIST_DEFS.map((d) => {
      const p = prevBy.get(d.key);
      const a = auto[d.key];
      const manualSet = p && !p.auto && p.status !== "PENDING";
      return {
        key: d.key,
        label: d.label,
        source: d.source,
        required: isRequired(d, band, online),
        status: manualSet ? p!.status : (a?.status ?? p?.status ?? "PENDING"),
        auto: manualSet ? false : !!a,
        evidence: a?.evidence ?? p?.evidence ?? null,
        note: p?.note ?? null,
        updatedById: p?.updatedById ?? null,
        updatedAt: p?.updatedAt ?? null,
      };
    }),
  };
}

/** What still blocks a decision: required items that are neither PASS nor WAIVED. */
export function missingItems(c: Checklist): ChecklistItem[] {
  return c.items.filter((i) => i.required && i.status !== "PASS" && i.status !== "WAIVED");
}
