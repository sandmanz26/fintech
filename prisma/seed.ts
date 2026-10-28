/**
 * Seed (PRD §11): 7 users, 40 reason codes, policy v1, 10 rules, ~200 fictional merchants
 * (~60% LOW, 28% MEDIUM, 10% HIGH, 2% PROHIBITED), 120 days of simulated transactions, and the
 * five story merchants. Run with `npm run seed` (resets the database first).
 */
import type { DeliveryModel, MerchantStatus, Prisma, RiskBand } from "@prisma/client";
import { db } from "@/lib/db";
import { record, SYSTEM_ACTOR, verifyIntegrity, type Actor } from "@/lib/domain/audit";
import { setSimToday, invalidateClock } from "@/lib/clock";
import { DEFAULT_POLICY } from "@/lib/domain/policy/defaults";
import { DEFAULT_RULES } from "@/lib/domain/rules/defaults";
import { REASON_CODES } from "@/lib/domain/reasonCodes";
import { scoreMerchant, type ScoringInput } from "@/lib/domain/scoring";
import { addDays, isoDay, utcDay } from "@/lib/domain/reserves/calc";
import { computeDailyMetrics } from "@/lib/domain/metrics";
import { runMonitoringRules } from "@/lib/domain/rules/service";
import { applyDailyReserves, releaseDueReserves, createControl } from "@/lib/domain/controls/service";
import { assignCase, transitionCase, addNote, dismissAlert } from "@/lib/domain/cases/service";
import { runSubmissionChecks, reviewWatchlistHit, updateChecklistItem } from "@/lib/domain/underwriting/service";
import { openDay } from "@/lib/jobs";
import { simulateDay } from "@/lib/sim/simulator";
import { SYSTEM_RULES, systemRuleDefinition } from "@/lib/domain/rules/system";
import { rng, type Rng } from "@/lib/sim/random";
import { businessName, personName, slug } from "@/lib/sim/names";
import { SIM_TODAY, STORY } from "@/lib/sim/stories";
import { mockKyb, mockWebsite } from "@/lib/adapters";
import { storage, tinyPdf } from "@/lib/storage";
import { CHECKLIST_DEFS } from "@/lib/domain/underwriting/checklist";

const T = utcDay(new Date(`${SIM_TODAY}T00:00:00Z`));
const HISTORY_DAYS = 120;
const START = addDays(T, -HISTORY_DAYS);
const MONITOR_FROM = addDays(T, -30);
const t0 = Date.now();
const log = (msg: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

const USERS = [
  { key: "rina", email: "rina@sentinel.test", name: "Rina Halim", role: "ANALYST" },
  { key: "dimas", email: "dimas@sentinel.test", name: "Dimas Pratama", role: "SENIOR_ANALYST" },
  { key: "laura", email: "laura@sentinel.test", name: "Laura Chen", role: "RISK_MANAGER" },
  { key: "ahmad", email: "ahmad@sentinel.test", name: "Ahmad Fauzi", role: "COMPLIANCE" },
  { key: "grace", email: "grace@sentinel.test", name: "Grace Okafor", role: "AUDITOR" },
  { key: "sam", email: "sam@sentinel.test", name: "Sam Torres", role: "ADMIN" },
  { key: "merchant", email: "owner@brightside.test", name: "Jonah Brightwell", role: "MERCHANT" },
] as const;

type U = { id: string; role: Actor["role"] & string };
const users: Record<string, U> = {};
const actor = (k: string) => ({ id: users[k].id, role: users[k].role }) as Actor & { id: string };

const STANDARD_MCC = ["5411", "5812", "5691", "5651", "5999", "7230", "8299", "7372", "5734", "5977", "5992", "7298", "8999"];
const ELEVATED_MCC = ["5732", "5968", "5815", "7011", "4121", "5945"];
const HIGH_MCC = ["4722", "5967", "6540", "5499", "4829"];

type Spec = {
  legalName: string;
  dbaName: string;
  registrationNo: string;
  country: string;
  mcc: string;
  website: string | null;
  incorporatedAt: Date;
  deliveryModel: DeliveryModel;
  avgDeliveryDays: number;
  expectedMonthlyVolumeMinor: bigint;
  expectedAvgTicketMinor: bigint;
  priorCbRatioBps: number | null;
  status: MerchantStatus;
  activatedAt: Date | null;
  decidedAt: Date | null;
  owners: { fullName: string; pct: number; controller: boolean; nationality: string; parent?: number }[];
  story?: keyof typeof STORY;
};

function monthsAgo(n: number) {
  const d = new Date(T);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d;
}

function owners(r: Rng, n = r.int(1, 3)) {
  const out: Spec["owners"] = [];
  let left = 100;
  for (let i = 0; i < n; i++) {
    const pct = i === n - 1 ? left : Math.max(10, Math.round((left * r.int(40, 70)) / 100));
    left -= pct;
    out.push({ fullName: personName(r), pct, controller: i === 0, nationality: r.chance(0.85) ? "US" : r.pick(["CA", "MX", "GB", "IN"]) });
  }
  return out;
}

function websiteFor(name: string, r: Rng, gaps = false) {
  const base = `https://${slug(name)}.example`;
  if (!gaps) return base;
  return r.pick([`${base}/norefund`, `${base}/noterms`, `${base}/nocontact`]);
}

function scoreSpec(s: Spec, asOf: Date) {
  const site = s.website ? { live: !s.website.includes("offline"), refundPolicy: !s.website.includes("norefund"), terms: !s.website.includes("noterms"), contact: !s.website.includes("nocontact") } : null;
  const input: ScoringInput = {
    asOf,
    mcc: s.mcc,
    country: s.country,
    incorporatedAt: s.incorporatedAt,
    deliveryModel: s.deliveryModel,
    avgDeliveryDays: s.avgDeliveryDays,
    expectedMonthlyVolumeMinor: s.expectedMonthlyVolumeMinor,
    expectedAvgTicketMinor: s.expectedAvgTicketMinor,
    currency: "USD",
    priorCbRatioBps: s.priorCbRatioBps,
    website: site,
    owners: s.owners.map((o) => ({ fullName: o.fullName, screeningStatus: "CLEAR", hits: [] })),
    merchantOnTerminatedList: false,
  };
  return scoreMerchant(input, DEFAULT_POLICY, 1);
}

/** Generate a background merchant whose deterministic score lands in the target band. */
function backgroundSpec(i: number, band: RiskBand, status: MerchantStatus): Spec {
  for (let attempt = 0; attempt < 200; attempt++) {
    const r = rng(`merchant:${i}:${attempt}`);
    let mcc: string;
    let deliveryModel: DeliveryModel;
    let days: number;
    let ageMonths: number;
    let prior: number | null = null;
    let monthly: number;
    let ticket: number;
    let country = "US";
    let gaps = false;
    if (band === "LOW") {
      mcc = r.pick(STANDARD_MCC);
      deliveryModel = r.pick(["IMMEDIATE", "IMMEDIATE", "SHIPPED", "DIGITAL"] as const);
      days = deliveryModel === "SHIPPED" ? r.int(2, 7) : 0;
      ageMonths = r.int(26, 140);
      prior = r.chance(0.5) ? r.int(5, 40) : null;
      monthly = r.int(8_000, 70_000);
      ticket = r.int(25, 140);
      if (r.chance(0.05)) country = "CA";
    } else if (band === "MEDIUM") {
      const useElevated = r.chance(0.65);
      mcc = useElevated ? r.pick(ELEVATED_MCC) : r.pick(STANDARD_MCC);
      deliveryModel = r.pick(["SHIPPED", "SHIPPED", "DIGITAL", "SUBSCRIPTION"] as const);
      days = deliveryModel === "SHIPPED" ? r.int(8, 20) : deliveryModel === "SUBSCRIPTION" ? r.int(3, 14) : 0;
      ageMonths = useElevated ? r.int(7, 23) : r.int(2, 5);
      prior = r.int(50, 85);
      monthly = r.int(20_000, 140_000);
      ticket = r.int(45, 260);
      if (r.chance(0.2)) country = r.pick(["CA", "GB", "MX"]);
      gaps = r.chance(0.2);
    } else if (band === "HIGH") {
      mcc = r.pick(HIGH_MCC);
      deliveryModel = mcc === "4722" ? "FUTURE_SERVICE" : r.pick(["SUBSCRIPTION", "SHIPPED", "DIGITAL"] as const);
      days = deliveryModel === "FUTURE_SERVICE" ? r.int(30, 90) : deliveryModel === "SHIPPED" ? r.int(10, 25) : r.int(0, 10);
      ageMonths = r.int(3, 20);
      prior = r.int(70, 130);
      monthly = r.int(30_000, 180_000);
      ticket = mcc === "4722" ? r.int(400, 1400) : r.int(40, 220);
      gaps = r.chance(0.3);
    } else {
      mcc = r.pick(["7995", "7273", "5962"]);
      deliveryModel = "DIGITAL";
      days = 0;
      ageMonths = r.int(4, 30);
      monthly = r.int(40_000, 200_000);
      ticket = r.int(30, 150);
    }
    const name = businessName(r, mcc);
    const incorporatedAt = monthsAgo(ageMonths);
    incorporatedAt.setUTCDate(r.int(1, 27));
    const isApp = ["SUBMITTED", "IN_UNDERWRITING", "PENDING_INFO", "DECLINED"].includes(status);
    // Activated merchants: most before the 120-day window, about 15% inside it.
    const activatedAt = isApp ? null : r.chance(0.15) ? addDays(T, -r.int(25, 110)) : addDays(T, -r.int(130, Math.max(140, Math.min(ageMonths * 30 - 10, 1500))));
    const s: Spec = {
      legalName: name.legal,
      dbaName: name.dba,
      registrationNo: `${country}-${(100000 + i * 7919).toString().slice(-6)}${r.int(10, 99)}`,
      country,
      mcc,
      website: deliveryModel === "IMMEDIATE" && r.chance(0.5) ? null : websiteFor(name.dba + i, r, gaps),
      incorporatedAt,
      deliveryModel,
      avgDeliveryDays: days,
      expectedMonthlyVolumeMinor: BigInt(monthly * 100),
      expectedAvgTicketMinor: BigInt(ticket * 100),
      priorCbRatioBps: prior,
      status,
      activatedAt,
      decidedAt: activatedAt ? addDays(activatedAt, -2) : status === "DECLINED" ? addDays(T, -r.int(5, 60)) : null,
      owners: owners(r),
    };
    const asOf = s.decidedAt ?? T;
    const sc = scoreSpec(s, asOf);
    const scNow = scoreSpec(s, T);
    if (sc.band === band && scNow.band === band) return s;
  }
  throw new Error(`Could not generate a ${band} merchant for slot ${i}`);
}

function storySpecs(): Spec[] {
  return [
    {
      story: "LUMEN",
      legalName: "Lumen Travel Co. LLC",
      dbaName: "Lumen Travel Co.",
      registrationNo: STORY.LUMEN,
      country: "US",
      mcc: "4722",
      website: "https://lumentravel.example",
      incorporatedAt: monthsAgo(4),
      deliveryModel: "FUTURE_SERVICE",
      avgDeliveryDays: 45,
      expectedMonthlyVolumeMinor: 37_500_000n, // $375,000
      expectedAvgTicketMinor: 85_000n, // $850
      priorCbRatioBps: null,
      status: "SUBMITTED",
      activatedAt: null,
      decidedAt: null,
      owners: [
        { fullName: "Isabel Moreau", pct: 70, controller: true, nationality: "US" },
        { fullName: "Kenji Watanabe", pct: 30, controller: false, nationality: "US" },
      ],
    },
    {
      story: "BRIGHTSIDE",
      legalName: "Brightside Electronics Inc.",
      dbaName: "Brightside Electronics",
      registrationNo: STORY.BRIGHTSIDE,
      country: "US",
      mcc: "5732",
      website: "https://brightside-electronics.example",
      incorporatedAt: monthsAgo(19),
      deliveryModel: "SHIPPED",
      avgDeliveryDays: 9,
      expectedMonthlyVolumeMinor: 24_000_000n, // $240,000
      expectedAvgTicketMinor: 25_000n, // $250
      priorCbRatioBps: 40,
      status: "ACTIVE",
      activatedAt: addDays(T, -260),
      decidedAt: addDays(T, -262),
      owners: [{ fullName: "Jonah Brightwell", pct: 100, controller: true, nationality: "US" }],
    },
    {
      story: "QUICKTOP",
      legalName: "QuickTop Gift Cards LLC",
      dbaName: "QuickTop Gift Cards",
      registrationNo: STORY.QUICKTOP,
      country: "US",
      mcc: "6540",
      website: "https://quicktop.example/nocontact",
      incorporatedAt: monthsAgo(14),
      deliveryModel: "DIGITAL",
      avgDeliveryDays: 0,
      expectedMonthlyVolumeMinor: 9_000_000n, // $90,000
      expectedAvgTicketMinor: 5_000n, // $50
      priorCbRatioBps: null,
      status: "ACTIVE",
      activatedAt: addDays(T, -190),
      decidedAt: addDays(T, -192),
      owners: [
        { fullName: "Rafael Ortega", pct: 55, controller: true, nationality: "US" },
        { fullName: "Mei Xu", pct: 45, controller: false, nationality: "US" },
      ],
    },
    {
      story: "GLOW",
      legalName: "Glow Subscription Box Inc.",
      dbaName: "Glow Subscription Box",
      registrationNo: STORY.GLOW,
      country: "US",
      mcc: "5968",
      website: "https://glowbox.example",
      incorporatedAt: monthsAgo(22),
      deliveryModel: "SUBSCRIPTION",
      avgDeliveryDays: 10,
      expectedMonthlyVolumeMinor: 36_000_000n, // $360,000
      expectedAvgTicketMinor: 4_000n, // $40
      priorCbRatioBps: 60,
      status: "ACTIVE",
      activatedAt: addDays(T, -420),
      decidedAt: addDays(T, -422),
      owners: [{ fullName: "Chloe Lindqvist", pct: 100, controller: true, nationality: "US" }],
    },
    {
      story: "NIMBUS",
      legalName: "Nimbus Supplements LLC",
      dbaName: "Nimbus Supplements",
      registrationNo: STORY.NIMBUS,
      country: "US",
      mcc: "5499",
      website: "https://nimbus-supplements.example",
      incorporatedAt: monthsAgo(16),
      deliveryModel: "SHIPPED",
      avgDeliveryDays: 9,
      expectedMonthlyVolumeMinor: 39_000_000n, // $390,000
      expectedAvgTicketMinor: 6_500n, // $65
      priorCbRatioBps: 95,
      status: "ACTIVE",
      activatedAt: addDays(T, -300),
      decidedAt: addDays(T, -302),
      owners: [
        { fullName: "Marek Dobrev", pct: 60, controller: true, nationality: "BG" },
        { fullName: "Sofia Petrov", pct: 40, controller: false, nationality: "US" },
      ],
    },
  ];
}

async function placeholderDocs() {
  const keys: Record<string, string> = {};
  for (const t of ["INCORPORATION", "BANK_STATEMENT", "ID_DOCUMENT", "PROCESSING_STATEMENT", "INVOICE"]) {
    keys[t] = await storage.put(tinyPdf(`Sentinel demo document: ${t.toLowerCase().replace("_", " ")}`), { ext: "pdf", prefix: "seed" });
  }
  return keys;
}

async function main() {
  if ((await db.user.count()) > 0) {
    console.error("The database already has data. `npm run seed` resets it first; `seed:only` needs an empty, migrated database.");
    process.exit(1);
  }
  log("Seeding Sentinel");
  await setSimToday(START);

  // Users, reason codes, policy, rules ----------------------------------------------------
  for (const u of USERS) {
    const created = await db.user.create({ data: { email: u.email, name: u.name, role: u.role } });
    users[u.key] = { id: created.id, role: created.role };
  }
  await db.reasonCode.createMany({ data: REASON_CODES });
  await db.policy.create({ data: { version: 1, params: DEFAULT_POLICY as never, changeNote: "Initial policy", activeFrom: new Date("2020-01-01T00:00:00Z"), createdById: users.laura.id } });
  for (const r of DEFAULT_RULES) {
    const def = r.definition;
    const rule = await db.rule.create({ data: { key: r.key, name: r.name, description: r.description } });
    const v = await db.ruleVersion.create({ data: { ruleId: rule.id, version: 1, definition: def as never, createdById: users.laura.id, changeNote: "Initial rule set" } });
    await db.rule.update({ where: { id: rule.id }, data: { activeVersionId: v.id } });
  }
  // System rules that pipeline alerts point at; they are never evaluated on metrics.
  for (const r of SYSTEM_RULES) {
    const rule = await db.rule.create({ data: { key: r.key, name: r.name, description: r.description, enabled: false } });
    const v = await db.ruleVersion.create({ data: { ruleId: rule.id, version: 1, createdById: users.laura.id, changeNote: "System rule", definition: systemRuleDefinition(r) as never } });
    await db.rule.update({ where: { id: rule.id }, data: { activeVersionId: v.id } });
  }
  await record(db, actor("sam"), { action: "SEED_STARTED", entityType: "System", entityId: "seed", after: { users: USERS.length, reasonCodes: REASON_CODES.length, rules: DEFAULT_RULES.length } });
  log("Reference data ready");

  // Merchants ---------------------------------------------------------------------------
  const docKeys = await placeholderDocs();
  const specs: Spec[] = [];
  const plan: { band: RiskBand; status: MerchantStatus; n: number }[] = [
    { band: "LOW", status: "ACTIVE", n: 110 },
    { band: "LOW", status: "SUBMITTED", n: 3 },
    { band: "LOW", status: "DECLINED", n: 3 },
    { band: "LOW", status: "CLOSED", n: 4 },
    { band: "MEDIUM", status: "ACTIVE", n: 47 },
    { band: "MEDIUM", status: "SUBMITTED", n: 3 },
    { band: "MEDIUM", status: "DECLINED", n: 3 },
    { band: "HIGH", status: "ACTIVE", n: 14 },
    { band: "HIGH", status: "SUBMITTED", n: 3 },
    { band: "HIGH", status: "DECLINED", n: 2 },
    { band: "PROHIBITED", status: "DECLINED", n: 2 },
    { band: "PROHIBITED", status: "SUBMITTED", n: 1 },
  ];
  let slot = 0;
  for (const p of plan) for (let i = 0; i < p.n; i++) specs.push(backgroundSpec(slot++, p.band, p.status));
  // A few underwriting applications that exercise the checklist: a KYB miss, a website gap and a near-match owner.
  const apps = specs.filter((s) => s.status === "SUBMITTED");
  if (apps[0]) apps[0].registrationNo = apps[0].registrationNo.slice(0, -3) + "000";
  if (apps[1]) apps[1].owners[0].fullName = "Tomas Reinhold";
  if (apps[4]) apps[4].website = (apps[4].website ?? "https://shop.example") + "/norefund";
  specs.push(...storySpecs());

  const merchantIds = new Map<Spec, string>();
  const ownerIdsBy = new Map<string, string[]>();
  for (const s of specs) {
    const r = rng(`create:${s.registrationNo}`);
    const createdAt = s.activatedAt ? addDays(s.activatedAt, -7) : s.decidedAt ? addDays(s.decidedAt, -5) : addDays(T, -r.int(1, 4));
    const status: MerchantStatus = s.status === "SUBMITTED" ? "SUBMITTED" : s.status;
    const m = await db.merchant.create({
      data: {
        legalName: s.legalName,
        dbaName: s.dbaName,
        registrationNo: s.registrationNo,
        country: s.country,
        mcc: s.mcc,
        website: s.website,
        incorporatedAt: s.incorporatedAt,
        deliveryModel: s.deliveryModel,
        avgDeliveryDays: s.avgDeliveryDays,
        expectedMonthlyVolumeMinor: s.expectedMonthlyVolumeMinor,
        expectedAvgTicketMinor: s.expectedAvgTicketMinor,
        priorCbRatioBps: s.priorCbRatioBps,
        status,
        activatedAt: s.activatedAt,
        createdAt,
        assignedToId: s.story === "LUMEN" ? users.dimas.id : null,
        ...(s.status === "CLOSED" ? { offboardedAt: addDays(T, -r.int(20, 90)), disputeWindowEndsAt: addDays(T, r.int(30, 100)) } : {}),
      },
    });
    merchantIds.set(s, m.id);
    const ids: string[] = [];
    for (const o of s.owners) {
      const or = rng(`owner:${s.registrationNo}:${o.fullName}`);
      const created = await db.owner.create({
        data: {
          merchantId: m.id,
          fullName: o.fullName,
          ownershipPct: o.pct,
          isController: o.controller,
          nationality: o.nationality,
          dateOfBirth: new Date(Date.UTC(or.int(1958, 1999), or.int(0, 11), or.int(1, 28))),
          idNumber: `${o.nationality}${or.int(10_000_000, 99_999_999)}`,
          screeningStatus: s.status === "SUBMITTED" ? "NOT_SCREENED" : "CLEAR",
        },
      });
      ids.push(created.id);
    }
    ownerIdsBy.set(m.id, ids);
    // A holding company for one in ten multi-owner merchants, to exercise the ownership tree.
    if (s.owners.length > 1 && r.chance(0.1)) {
      await db.owner.update({ where: { id: ids[1] }, data: { parentOwnerId: ids[0] } });
    }

    const decided = s.decidedAt && s.status !== "SUBMITTED";
    const kyb = await mockKyb.verify({ legalName: s.legalName, registrationNo: s.registrationNo, country: s.country });
    const web = await mockWebsite.check(s.website);
    const band = scoreSpec(s, s.decidedAt ?? T).band;
    await db.application.create({
      data: {
        merchantId: m.id,
        submittedAt: decided ? addDays(s.decidedAt!, -3) : createdAt,
        decidedAt: decided ? s.decidedAt : null,
        decision: decided ? (s.status === "DECLINED" ? "DECLINED" : band === "HIGH" ? "APPROVED_WITH_CONDITIONS" : "APPROVED") : null,
        decisionReasonCode: decided ? (s.status === "DECLINED" ? (band === "PROHIBITED" ? "UW-DECLINE-PROHIBITED" : r.pick(["UW-DECLINE-RISK", "UW-DECLINE-KYB", "UW-DECLINE-WEBSITE"])) : band === "HIGH" ? "UW-CONDITIONS-DELIVERY" : "UW-STANDARD") : null,
        decisionNote: decided ? (s.status === "DECLINED" ? "Declined at review." : "Checks complete; within appetite.") : null,
        decidedById: decided ? (band === "HIGH" ? users.dimas.id : r.pick([users.rina.id, users.dimas.id])) : null,
        effectiveFrom: s.activatedAt,
        checklist: {
          items: CHECKLIST_DEFS.map((d) => ({ key: d.key, label: d.label, source: d.source, required: false, status: decided ? "PASS" : "PENDING", auto: false, note: null })),
        } as never,
        checks: { kyb, website: web } as never,
      },
    });
    // Documents on file
    if (s.status !== "SUBMITTED") {
      const docs: { type: string; status: string }[] = [
        { type: "INCORPORATION", status: "ACCEPTED" },
        { type: "ID_DOCUMENT", status: "ACCEPTED" },
      ];
      if (band !== "LOW") docs.push({ type: "BANK_STATEMENT", status: "ACCEPTED" });
      for (const d of docs) {
        await db.document.create({
          data: {
            merchantId: m.id,
            type: d.type,
            fileKey: docKeys[d.type],
            fileName: `${d.type.toLowerCase()}.pdf`,
            mimeType: "application/pdf",
            sizeBytes: 700,
            status: d.status,
            uploadedBy: "merchant",
            uploadedAt: createdAt,
            expiresAt: d.type === "ID_DOCUMENT" ? addDays(T, r.int(-20, 700)) : null,
          },
        });
      }
    }
    // Historical assessment at the decision date (imported, so written directly).
    if (s.status !== "SUBMITTED") {
      const sc = scoreSpec(s, T);
      await db.riskAssessment.create({
        data: { merchantId: m.id, policyVersion: 1, score: sc.score, band: sc.band, factors: sc.factors as never, hardStops: sc.hardStops as never, trigger: "ONBOARDING", createdAt: s.decidedAt ?? createdAt, createdById: users.dimas.id },
      });
      const months = sc.band === "PROHIBITED" ? 1 : DEFAULT_POLICY.rescoreMonths[sc.band];
      const next = new Date(T);
      next.setUTCMonth(next.getUTCMonth() + months);
      next.setUTCDate(rng(`review:${s.registrationNo}`).int(1, 28));
      await db.merchant.update({ where: { id: m.id }, data: { currentBand: sc.band, currentScore: sc.score, nextReviewAt: next } });
    }
  }
  await record(db, SYSTEM_ACTOR, { action: "MERCHANTS_IMPORTED", entityType: "System", entityId: "seed", after: { merchants: specs.length } });
  log(`${specs.length} merchants created`);

  const byStory = (k: keyof typeof STORY) => merchantIds.get(specs.find((s) => s.story === k)!)!;

  // Historical controls ------------------------------------------------------------------
  const highActive = specs.filter((s) => s.status === "ACTIVE" && !s.story && scoreSpec(s, T).band === "HIGH");
  for (const [i, s] of highActive.entries()) {
    const id = merchantIds.get(s)!;
    const eff = s.activatedAt! > START ? s.activatedAt! : addDays(START, i % 10);
    await setSimToday(eff);
    const kind = i % 5;
    const type = kind <= 2 ? "ROLLING_RESERVE" : kind === 3 ? "PAYOUT_DELAY" : "VOLUME_LIMIT_DAILY";
    const params = type === "ROLLING_RESERVE" ? { pctBps: 500, holdDays: 90 } : type === "PAYOUT_DELAY" ? { days: 3 } : { limitMinor: String((s.expectedMonthlyVolumeMinor / 30n) * 2n) };
    const reviewAt = i < 2 ? addDays(T, -1) : i < 4 ? addDays(T, 6 + i) : addDays(T, 30 + i * 5);
    await db.$transaction((tx) =>
      createControl(actor("dimas"), { merchantId: id, type, params, reasonCode: type === "ROLLING_RESERVE" ? "CT-FUTURE-DELIVERY" : "CT-NEW-MERCHANT", note: "Condition of approval for a high-risk category.", reviewAt: isoDay(reviewAt.getTime() > eff.getTime() ? reviewAt : addDays(eff, 30)), effectiveFrom: isoDay(eff) }, tx),
    );
  }
  // Nimbus has carried a 5% rolling reserve since before the window.
  await setSimToday(START);
  await db.$transaction((tx) =>
    createControl(actor("dimas"), { merchantId: byStory("NIMBUS"), type: "ROLLING_RESERVE", params: { pctBps: 500, holdDays: 90 }, reasonCode: "CT-CHARGEBACKS", note: "Prior processor chargeback ratio above 0.9%; reserve as a condition of approval.", reviewAt: isoDay(addDays(T, 20)), effectiveFrom: isoDay(START) }, tx),
  );
  log(`${highActive.length + 1} historical controls`);

  // 120 days of trading ------------------------------------------------------------------
  let txTotal = 0;
  for (let i = 0; i < HISTORY_DAYS; i++) {
    const day = addDays(START, i);
    await setSimToday(day);
    const r = await simulateDay(day);
    txTotal += r.transactions;
    await computeDailyMetrics(day, BigInt(DEFAULT_POLICY.smallAuthThresholdMinor));
    if (day >= MONITOR_FROM) {
      await setSimToday(addDays(day, 1));
      invalidateClock();
      await runMonitoringRules(day);
    }
    await applyDailyReserves(day);
    await releaseDueReserves(addDays(day, 1));
    if (i % 10 === 9) log(`  day ${i + 1}/${HISTORY_DAYS} (${txTotal.toLocaleString()} transactions)`);
  }
  log(`${txTotal.toLocaleString()} transactions, metrics and alerts for ${HISTORY_DAYS} days`);

  // Work the older cases so queues look like a team's real backlog --------------------------
  const storyIds = new Set(Object.keys(STORY).map((k) => byStory(k as keyof typeof STORY)));
  const old = await db.case.findMany({ where: { createdAt: { lt: addDays(T, -3) }, status: { not: "RESOLVED" } }, include: { alerts: true }, orderBy: { createdAt: "asc" } });
  let worked = 0;
  for (const [i, c] of old.entries()) {
    if (storyIds.has(c.merchantId)) continue;
    const r = rng(`work:${i}`);
    const who = r.chance(0.6) ? "rina" : "dimas";
    await setSimToday(addDays(utcDay(c.createdAt), 0));
    invalidateClock();
    await assignCase(c.id, users[who].id, actor(who));
    // A working team closes most of what comes in: ~70% reviewed and closed, ~15% closed with a
    // control, ~10% in review waiting on information, ~5% still only assigned.
    const roll = r.next();
    if (roll < 0.95) {
      await transitionCase(c.id, "IN_REVIEW", actor(who));
      await setSimToday(addDays(utcDay(c.createdAt), 1));
      invalidateClock();
      if (roll < 0.7) {
        for (const a of c.alerts) {
          if (r.chance(0.7)) await dismissAlert(a.id, r.pick(["AD-EXPECTED-SEASONAL", "AD-KNOWN-PROMOTION", "AD-BELOW-MATERIALITY", "AD-VERIFIED-LEGITIMATE"]), "Reviewed against order history; consistent with the business.", actor(who));
        }
        await transitionCase(c.id, "RESOLVED", actor(who), { reasonCode: r.pick(["CR-NO-ACTION", "CR-EXPLAINED", "CR-MONITOR"]), note: "Activity reviewed against the merchant's profile and history." });
      } else if (roll < 0.85) {
        const m = await db.merchant.findUniqueOrThrow({ where: { id: c.merchantId } });
        await createControl(actor(who), {
          merchantId: c.merchantId,
          type: "VOLUME_LIMIT_DAILY",
          params: { limitMinor: String((m.expectedMonthlyVolumeMinor / 30n) * 3n) },
          reasonCode: "CT-VOLUME-SPIKE",
          note: "Temporary limit while volume settles back to profile.",
          reviewAt: isoDay(addDays(T, r.int(8, 40))),
          caseId: c.id,
        });
        await transitionCase(c.id, "RESOLVED", actor(who), { reasonCode: "CR-CONTROL-APPLIED", note: "Daily limit set at 3x declared daily volume." });
      } else {
        await addNote(c.id, "Waiting for the next statement before deciding.", actor(who));
      }
    }
    worked++;
  }
  log(`${worked} historical cases worked`);

  // Stories ------------------------------------------------------------------------------
  await setSimToday(T);
  invalidateClock();
  // S1: Lumen applies; checks run; documents arrive; Dimas has the case.
  const lumen = byStory("LUMEN");
  await runSubmissionChecks(lumen);
  for (const t of ["BANK_STATEMENT", "PROCESSING_STATEMENT", "INCORPORATION", "ID_DOCUMENT"]) {
    await db.document.create({
      data: { merchantId: lumen, type: t, fileKey: docKeys[t === "PROCESSING_STATEMENT" ? "PROCESSING_STATEMENT" : t], fileName: `${t.toLowerCase()}.pdf`, mimeType: "application/pdf", sizeBytes: 700, status: t === "INCORPORATION" || t === "ID_DOCUMENT" ? "ACCEPTED" : "PENDING_REVIEW", uploadedBy: "merchant", uploadedAt: addDays(T, -1) },
    });
  }
  const lumenCase = await db.case.findFirstOrThrow({ where: { merchantId: lumen, type: "UNDERWRITING" } });
  await assignCase(lumenCase.id, users.dimas.id, actor("laura"));
  // Other applications go through the same checks.
  for (const s of specs.filter((x) => x.status === "SUBMITTED" && !x.story)) await runSubmissionChecks(merchantIds.get(s)!);
  // One medium application already has its bank statements accepted and only the website item left.
  const medApp = await db.application.findFirst({ where: { merchant: { status: "IN_UNDERWRITING", currentBand: "MEDIUM" } } });
  if (medApp) await updateChecklistItem(actor("rina"), medApp.id, "bank_statement", "PASS", "Three months received and reconciled to declared volume.");

  // S2: Brightside's spike case goes to Rina.
  const bright = await db.case.findFirst({ where: { merchantId: byStory("BRIGHTSIDE"), status: { not: "RESOLVED" } } });
  if (bright) await assignCase(bright.id, users.rina.id, actor("laura"));
  // S4: Glow's dispute case is with Dimas, in review.
  const glow = await db.case.findFirst({ where: { merchantId: byStory("GLOW"), type: "DISPUTE_SPIKE", status: { not: "RESOLVED" } } });
  if (glow) {
    await setSimToday(addDays(utcDay(glow.createdAt), 1));
    invalidateClock();
    await assignCase(glow.id, users.dimas.id, actor("laura"));
    await transitionCase(glow.id, "IN_REVIEW", actor("dimas"));
    await addNote(glow.id, "Merchant changed its billing descriptor last month; most disputes are 'not recognised'. Watching the 30-day ratio.", actor("dimas"));
    await setSimToday(T);
    invalidateClock();
  }
  // S5: Nimbus owner hit on periodic re-screening; Ahmad confirms it.
  const nimbus = byStory("NIMBUS");
  await setSimToday(addDays(T, -12));
  invalidateClock();
  const marek = (await db.owner.findFirstOrThrow({ where: { merchantId: nimbus, fullName: "Marek Dobrev" } })).id;
  const hit = await db.watchlistHit.create({ data: { ownerId: marek, listName: "SANCTIONS_MOCK", matchedName: "Marek Dobrev", matchScore: 100, createdAt: addDays(T, -12) } });
  await db.owner.update({ where: { id: marek }, data: { screeningStatus: "POTENTIAL_MATCH" } });
  await record(db, SYSTEM_ACTOR, { action: "WATCHLIST_RESCREEN_HIT", entityType: "Owner", entityId: marek, after: { listName: "SANCTIONS_MOCK", matchScore: 100 } });
  await setSimToday(addDays(T, -10));
  invalidateClock();
  await reviewWatchlistHit(actor("ahmad"), hit.id, "CONFIRMED", "Name, date of birth and nationality match the listed individual; confirmed with the list provider.");
  const wcase = await db.case.findFirst({ where: { merchantId: nimbus, type: "WATCHLIST" } });
  if (wcase) {
    await assignCase(wcase.id, users.rina.id, actor("ahmad"));
    await transitionCase(wcase.id, "IN_REVIEW", actor("rina"));
    await addNote(wcase.id, "@Ahmad confirmed the match. Chargebacks are also above 1% for three months. Preparing a termination proposal.", actor("rina"));
  }
  const ncase = await db.case.findFirst({ where: { merchantId: nimbus, type: "DISPUTE_SPIKE", status: { not: "RESOLVED" } } });
  if (ncase) await assignCase(ncase.id, users.rina.id, actor("laura"));

  // Demo staging: the story cases are today's work. Their alerts started weeks ago (that is the
  // story), but the open cases are put within SLA from today, whatever time of day the demo is
  // opened (the sim clock uses the real time of day), so the queues read as a live day.
  const hoursBy = { CRITICAL: DEFAULT_POLICY.sla.CRITICAL, HIGH: DEFAULT_POLICY.sla.HIGH, MEDIUM: DEFAULT_POLICY.sla.MEDIUM, LOW: DEFAULT_POLICY.sla.LOW_BUSINESS_DAYS * 24 } as const;
  const storyCases = await db.case.findMany({ where: { merchantId: { in: [...storyIds] }, status: { not: "RESOLVED" } } });
  for (const c of storyCases) {
    await db.case.update({ where: { id: c.id }, data: { slaDueAt: new Date(addDays(T, 1).getTime() + hoursBy[c.priority] * 3_600_000), slaBreachedAt: null } });
    await db.notification.deleteMany({ where: { dedupeKey: `SLA:${c.id}` } });
  }

  // Today -----------------------------------------------------------------------------------
  await setSimToday(T);
  invalidateClock();
  await openDay(T);
  const v = await verifyIntegrity();
  const counts = {
    merchants: await db.merchant.count(),
    transactions: await db.transaction.count(),
    metrics: await db.dailyMerchantMetric.count(),
    alerts: await db.alert.count(),
    openCases: await db.case.count({ where: { status: { not: "RESOLVED" } } }),
    audit: await db.auditLog.count(),
  };
  const bands = await db.merchant.groupBy({ by: ["currentBand"], _count: true });
  log(`Done. ${JSON.stringify(counts)}`);
  log(`Bands: ${bands.map((b) => `${b.currentBand}=${b._count}`).join(", ")}`);
  log(`Audit chain: ${v.ok ? `intact (${v.checked} rows)` : `BROKEN at ${v.firstBrokenId}`}`);
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});

export type { Prisma };
