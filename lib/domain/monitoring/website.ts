import { db } from "@/lib/db";
import { adapters, type WebsiteResult, type WebsiteScanResult } from "@/lib/adapters";
import { hashString } from "@/lib/sim/random";
import { DAY_MS, isoDay, utcDay } from "@/lib/domain/reserves/calc";
import { raiseSystemAlert } from "@/lib/domain/rules/system";
import { PROCESSING_STATES } from "@/lib/domain/merchantStateMachine";

/**
 * Ongoing website monitoring (Visa payfac risk guide; ROAST.md §3.1). Each processing merchant's
 * site is re-crawled once a week, on a weekday fixed by its id so the load spreads over the week.
 * Only findings that are new since the previous scan (or the onboarding check) raise an alert.
 */

export type WebsiteFinding = "OFFLINE" | "MISSING_REFUND_POLICY" | "MISSING_TERMS" | "MISSING_CONTACT" | "RESTRICTED_PRODUCTS";

export const FINDING_LABEL: Record<WebsiteFinding, string> = {
  OFFLINE: "Site offline",
  MISSING_REFUND_POLICY: "Refund policy removed",
  MISSING_TERMS: "Terms removed",
  MISSING_CONTACT: "Contact details removed",
  RESTRICTED_PRODUCTS: "Restricted products on sale",
};

/** Pure: what is wrong with a site right now. */
export function findingsFor(w: Pick<WebsiteResult, "live" | "refundPolicy" | "terms" | "contact"> & { restricted?: string[] }): WebsiteFinding[] {
  if (!w.live) return ["OFFLINE"];
  const out: WebsiteFinding[] = [];
  if (!w.refundPolicy) out.push("MISSING_REFUND_POLICY");
  if (!w.terms) out.push("MISSING_TERMS");
  if (!w.contact) out.push("MISSING_CONTACT");
  if (w.restricted?.length) out.push("RESTRICTED_PRODUCTS");
  return out;
}

/** Pure: is this merchant due for a scan today? Weekly, plus immediately if never scanned. */
export function scanDue(merchantId: string, day: Date, lastScan: Date | null): boolean {
  if (!lastScan) return true;
  const dayIndex = Math.floor(utcDay(day).getTime() / DAY_MS);
  return (dayIndex + hashString(merchantId)) % 7 === 0 && isoDay(lastScan) < isoDay(day);
}

export async function monitorWebsites(day: Date): Promise<{ scanned: number; alerts: number }> {
  const d = utcDay(day);
  const merchants = await db.merchant.findMany({
    where: { status: { in: PROCESSING_STATES }, website: { not: null } },
    select: {
      id: true,
      website: true,
      websiteScans: { orderBy: { scannedAt: "desc" }, take: 1 },
      applications: { orderBy: { submittedAt: "desc" }, take: 1, select: { checks: true } },
    },
  });
  let scanned = 0;
  let alerts = 0;
  for (const m of merchants) {
    const last = m.websiteScans[0] ?? null;
    if (!scanDue(m.id, d, last?.scannedAt ?? null)) continue;
    const res: WebsiteScanResult = await adapters.website.scan(m.website!, d);
    const findings = findingsFor(res);
    // Baseline: the last scan, else what the onboarding check saw (imported merchants: a clean site).
    const onboarding = (m.applications[0]?.checks as { website?: WebsiteResult } | null)?.website;
    const before: WebsiteFinding[] = last ? (last.findings as WebsiteFinding[]) : onboarding ? findingsFor(onboarding) : [];
    const fresh = findings.filter((f) => !before.includes(f));
    await db.$transaction(async (tx) => {
      await tx.websiteScan.create({
        data: { merchantId: m.id, scannedAt: d, url: m.website!, live: res.live, refundPolicy: res.refundPolicy, terms: res.terms, contact: res.contact, categories: res.categories, findings },
      });
      if (!fresh.length) return;
      const id = await raiseSystemAlert(tx, {
        ruleKey: "R-WEBSITE-CHANGE",
        merchantId: m.id,
        day: d,
        dedupeKey: `R-WEBSITE-CHANGE:${m.id}:${isoDay(d)}`,
        severity: fresh.includes("RESTRICTED_PRODUCTS") || fresh.includes("OFFLINE") ? "HIGH" : "MEDIUM",
        evidence: { url: m.website, findings: fresh.map((f) => FINDING_LABEL[f]), restricted: res.restricted, categories: res.categories, previous: before.map((f) => FINDING_LABEL[f]), date: isoDay(d) },
      });
      if (id) alerts++;
    });
    scanned++;
  }
  return { scanned, alerts };
}
