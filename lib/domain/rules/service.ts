import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { record, type Actor, SYSTEM_ACTOR } from "@/lib/domain/audit";
import { getActivePolicy, networkLines } from "@/lib/domain/policy";
import { buildMetricContext, networkHistoryStart, type DayRow } from "@/lib/domain/metrics/context";
import { loadDayRows } from "@/lib/domain/metrics";
import { addDays, isoDay, utcDay } from "@/lib/domain/reserves/calc";
import { routeAlert } from "@/lib/domain/cases/service";
import { DomainError, NotFoundError } from "@/lib/errors";
import { RuleDefinitionSchema, evaluateRule, dedupeKey, type RuleDefinition, type RuleSubject, type TraceNode } from "./dsl";
import { PROCESSING_STATES } from "@/lib/domain/merchantStateMachine";
import { SYSTEM_RULE_KEYS } from "./system";

export async function activeRules() {
  const rules = await db.rule.findMany({ where: { enabled: true, activeVersionId: { not: null } }, include: { versions: true } });
  return rules.map((r) => {
    const v = r.versions.find((x) => x.id === r.activeVersionId)!;
    return { rule: r, version: v, def: RuleDefinitionSchema.parse(v.definition) };
  });
}

function lastTxnFromRows(rows: DayRow[], date: string): string | null {
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].date <= date && rows[i].attempts > 0) return rows[i].date;
  return null;
}

type MerchantForRules = {
  id: string;
  status: string;
  country: string;
  activatedAt: Date | null;
  createdAt: Date;
  expectedAvgTicketMinor: bigint;
  expectedMonthlyVolumeMinor: bigint;
};

function subjectFor(m: MerchantForRules, date: string): RuleSubject {
  const since = m.activatedAt ?? m.createdAt;
  const ageDays = Math.floor((new Date(`${date}T00:00:00Z`).getTime() - utcDay(since).getTime()) / 86_400_000);
  return { merchantId: m.id, status: m.status, ageDays, date };
}

/**
 * Evaluate every active rule for every monitored merchant on `day` (PRD §6.3 pipeline).
 * Idempotent through the unique dedupeKey on Alert.
 */
export async function runMonitoringRules(day: Date): Promise<{ evaluated: number; alerts: number }> {
  const date = isoDay(day);
  const policy = await getActivePolicy();
  const rules = await activeRules();
  const merchants = await db.merchant.findMany({
    where: { status: { in: PROCESSING_STATES } },
    select: { id: true, status: true, country: true, activatedAt: true, createdAt: true, expectedAvgTicketMinor: true, expectedMonthlyVolumeMinor: true },
  });
  const rowsBy = await loadDayRows(merchants.map((m) => m.id), networkHistoryStart(day), day);
  const spikes = await db.alert.groupBy({
    by: ["merchantId"],
    where: { ruleKey: "R-VOL-SPIKE", metricDate: { gte: addDays(day, -14), lt: utcDay(day) } },
    _count: true,
  });
  const spikeBy = new Map(spikes.map((s) => [s.merchantId, s._count]));
  const lines = networkLines(policy.params);
  let evaluated = 0;
  let created = 0;

  for (const m of merchants) {
    const rows = rowsBy.get(m.id) ?? [];
    const metrics = buildMetricContext(
      rows,
      date,
      {
        expectedAvgTicketMinor: Number(m.expectedAvgTicketMinor),
        expectedMonthlyVolumeMinor: Number(m.expectedMonthlyVolumeMinor),
        isDomestic: policy.params.scoring.primaryCountries.includes(m.country),
      },
      { lines, volSpikeAlerts14d: spikeBy.get(m.id) ?? 0, lastTxnDate: lastTxnFromRows(rows, date) },
    );
    for (const { rule, version, def } of rules) {
      evaluated++;
      const subject = subjectFor(m, date);
      const res = evaluateRule(def, subject, metrics);
      if (!res.fired) continue;
      const key = dedupeKey(def, subject);
      // Window-based dedupe: one alert per rule+merchant inside windowHours.
      const windowStart = new Date(new Date(`${date}T00:00:00Z`).getTime() - (def.dedupe.windowHours - 24) * 3_600_000);
      const recent = await db.alert.findFirst({
        where: { merchantId: m.id, ruleKey: def.key, metricDate: { gte: utcDay(windowStart), lt: utcDay(day) } },
        select: { id: true },
      });
      if (recent) continue;
      const exists = await db.alert.findUnique({ where: { dedupeKey: key }, select: { id: true } });
      if (exists) continue;
      await db.$transaction(async (tx) => {
        const alert = await tx.alert.create({
          data: {
            merchantId: m.id,
            ruleVersionId: version.id,
            ruleKey: def.key,
            severity: def.severity,
            evidence: { metrics: res.evidence, trace: res.trace, date, ruleVersion: version.version } as unknown as Prisma.InputJsonValue,
            dedupeKey: key,
            metricDate: utcDay(day),
          },
        });
        await record(tx, SYSTEM_ACTOR, { action: "ALERT_CREATED", entityType: "Alert", entityId: alert.id, after: { ruleKey: def.key, merchantId: m.id, date } });
        await routeAlert(tx, alert, def.autoCase, rule.name);
      }, { timeout: 20_000 });
      created++;
    }
  }
  return { evaluated, alerts: created };
}

// ---------------------------------------------------------------------------
// Backtest (PRD §6.3): evaluate a definition over the last N days of metrics, writing nothing.

export type BacktestResult = {
  days: { date: string; candidate: number; active: number }[];
  merchants: { merchantId: string; name: string; candidateDays: number; activeDays: number; firstDate: string }[];
  totals: { candidate: number; active: number; candidateMerchants: number; activeMerchants: number; onlyCandidate: number; onlyActive: number };
  durationMs: number;
};

export async function backtestRule(candidate: RuleDefinition, activeDef: RuleDefinition | null, days = 90, endDay?: Date): Promise<BacktestResult> {
  const started = Date.now();
  const policy = await getActivePolicy();
  const { simToday } = await import("@/lib/clock");
  const end = utcDay(endDay ?? addDays(await simToday(), -1));
  const start = addDays(end, -(days - 1));
  const merchants = await db.merchant.findMany({
    where: { status: { notIn: ["APPLICATION_DRAFT", "SUBMITTED", "IN_UNDERWRITING", "PENDING_INFO", "DECLINED"] } },
    select: { id: true, status: true, legalName: true, dbaName: true, country: true, activatedAt: true, createdAt: true, expectedAvgTicketMinor: true, expectedMonthlyVolumeMinor: true },
  });
  const rowsBy = await loadDayRows(null, networkHistoryStart(start), end);
  const spikeAlerts = await db.alert.findMany({
    where: { ruleKey: "R-VOL-SPIKE", metricDate: { gte: addDays(start, -14), lte: end } },
    select: { merchantId: true, metricDate: true },
  });
  const spikesBy = new Map<string, string[]>();
  for (const a of spikeAlerts) spikesBy.set(a.merchantId, [...(spikesBy.get(a.merchantId) ?? []), isoDay(a.metricDate)]);
  const lines = networkLines(policy.params);
  const perDay = new Map<string, { candidate: number; active: number }>();
  const perMerchant = new Map<string, { candidateDays: number; activeDays: number; firstDate: string }>();

  for (let i = 0; i < days; i++) {
    const date = isoDay(addDays(start, i));
    perDay.set(date, { candidate: 0, active: 0 });
  }

  for (const m of merchants) {
    const rows = rowsBy.get(m.id) ?? [];
    if (!rows.length) continue;
    const facts = {
      expectedAvgTicketMinor: Number(m.expectedAvgTicketMinor),
      expectedMonthlyVolumeMinor: Number(m.expectedMonthlyVolumeMinor),
      isDomestic: policy.params.scoring.primaryCountries.includes(m.country),
    };
    const spikes = spikesBy.get(m.id) ?? [];
    for (let i = 0; i < days; i++) {
      const date = isoDay(addDays(start, i));
      if (!rows.some((r) => r.date === date)) continue; // merchant not processing that day
      const from14 = isoDay(addDays(new Date(`${date}T00:00:00Z`), -14));
      const metrics = buildMetricContext(rows, date, facts, {
        lines,
        volSpikeAlerts14d: spikes.filter((d) => d >= from14 && d < date).length,
        lastTxnDate: lastTxnFromRows(rows, date),
      });
      // The backtest asks "would this rule have fired on this day", so status filters use
      // processing as of then: every day with a metric row counts as monitored.
      const subject = { ...subjectFor(m, date), status: "ACTIVE" };
      const c = evaluateRule(candidate, subject, metrics).fired;
      const a = activeDef ? evaluateRule(activeDef, subject, metrics).fired : false;
      if (!c && !a) continue;
      const d = perDay.get(date)!;
      if (c) d.candidate++;
      if (a) d.active++;
      const pm = perMerchant.get(m.id) ?? { candidateDays: 0, activeDays: 0, firstDate: date };
      if (c) pm.candidateDays++;
      if (a) pm.activeDays++;
      perMerchant.set(m.id, pm);
    }
  }
  const names = new Map(merchants.map((m) => [m.id, m.dbaName ?? m.legalName]));
  const merchantsOut = [...perMerchant.entries()]
    .map(([merchantId, v]) => ({ merchantId, name: names.get(merchantId) ?? merchantId, ...v }))
    .sort((a, b) => b.candidateDays - a.candidateDays || b.activeDays - a.activeDays);
  const daysOut = [...perDay.entries()].map(([date, v]) => ({ date, ...v }));
  return {
    days: daysOut,
    merchants: merchantsOut,
    totals: {
      candidate: daysOut.reduce((s, d) => s + d.candidate, 0),
      active: daysOut.reduce((s, d) => s + d.active, 0),
      candidateMerchants: merchantsOut.filter((m) => m.candidateDays > 0).length,
      activeMerchants: merchantsOut.filter((m) => m.activeDays > 0).length,
      onlyCandidate: merchantsOut.filter((m) => m.candidateDays > 0 && m.activeDays === 0).length,
      onlyActive: merchantsOut.filter((m) => m.activeDays > 0 && m.candidateDays === 0).length,
    },
    durationMs: Date.now() - started,
  };
}

// ---------------------------------------------------------------------------
// Versions

export async function createRuleVersion(
  actor: Actor,
  input: { ruleId?: string; name: string; description: string; definition: unknown; changeNote: string; activate: boolean },
) {
  const def = RuleDefinitionSchema.parse(input.definition);
  if (!input.changeNote.trim()) throw new DomainError("CHANGE_NOTE_REQUIRED", "Every rule version needs a change note.");
  return db.$transaction(async (tx) => {
    let rule = input.ruleId ? await tx.rule.findUnique({ where: { id: input.ruleId } }) : null;
    if (input.ruleId && !rule) throw new NotFoundError("Rule");
    if (SYSTEM_RULE_KEYS.has(rule?.key ?? def.key)) throw new DomainError("SYSTEM_RULE", "System rules cannot be edited.");
    if (!rule) {
      const clash = await tx.rule.findUnique({ where: { key: def.key } });
      if (clash) throw new DomainError("KEY_TAKEN", `A rule with key ${def.key} already exists.`, 409);
      rule = await tx.rule.create({ data: { key: def.key, name: input.name, description: input.description } });
    } else if (rule.key !== def.key) {
      throw new DomainError("KEY_CHANGED", "A rule's key cannot change between versions.");
    }
    const last = await tx.ruleVersion.findFirst({ where: { ruleId: rule.id }, orderBy: { version: "desc" } });
    const version = await tx.ruleVersion.create({
      data: { ruleId: rule.id, version: (last?.version ?? 0) + 1, definition: def as never, createdById: actor.id ?? "system", changeNote: input.changeNote },
    });
    await tx.rule.update({
      where: { id: rule.id },
      data: { name: input.name, description: input.description, ...(input.activate ? { activeVersionId: version.id } : {}) },
    });
    await record(tx, actor, {
      action: "RULE_VERSION_CREATED",
      entityType: "Rule",
      entityId: rule.id,
      before: last ? { version: last.version, activeVersionId: rule.activeVersionId } : null,
      after: { version: version.version, activated: input.activate, changeNote: input.changeNote },
    });
    return { rule, version };
  });
}

export async function setRuleEnabled(actor: Actor, ruleId: string, enabled: boolean) {
  return db.$transaction(async (tx) => {
    const r = await tx.rule.findUnique({ where: { id: ruleId } });
    if (!r) throw new NotFoundError("Rule");
    if (SYSTEM_RULE_KEYS.has(r.key)) throw new DomainError("SYSTEM_RULE", "System rules cannot be switched on or off.");
    await tx.rule.update({ where: { id: ruleId }, data: { enabled } });
    await record(tx, actor, { action: enabled ? "RULE_ENABLED" : "RULE_DISABLED", entityType: "Rule", entityId: ruleId, before: { enabled: r.enabled }, after: { enabled } });
  });
}

export async function activateRuleVersion(actor: Actor, ruleId: string, versionId: string) {
  return db.$transaction(async (tx) => {
    const r = await tx.rule.findUnique({ where: { id: ruleId } });
    const v = await tx.ruleVersion.findUnique({ where: { id: versionId } });
    if (!r || !v || v.ruleId !== ruleId) throw new NotFoundError("Rule version");
    await tx.rule.update({ where: { id: ruleId }, data: { activeVersionId: versionId } });
    await record(tx, actor, { action: "RULE_VERSION_ACTIVATED", entityType: "Rule", entityId: ruleId, before: { activeVersionId: r.activeVersionId }, after: { activeVersionId: versionId, version: v.version } });
  });
}

/** Per-rule performance (PRD §2.3 alert precision; §6.8 rule performance widget). */
export async function ruleStats() {
  const rows = await db.$queryRaw<{ ruleKey: string; total: number; dismissed: number; open: number; actioned: number }[]>`
    SELECT a."ruleKey",
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE a.status = 'DISMISSED')::int AS dismissed,
      COUNT(*) FILTER (WHERE a.status = 'OPEN')::int AS open,
      COUNT(DISTINCT a.id) FILTER (WHERE EXISTS (
        SELECT 1 FROM "Control" c WHERE c."caseId" = a."caseId" AND c.status IN ('ACTIVE','EXPIRED','REMOVED')
      ) OR EXISTS (
        SELECT 1 FROM "ApprovalRequest" r WHERE r."caseId" = a."caseId" AND r."actionType" = 'TERMINATE' AND r.status = 'APPROVED'
      ))::int AS actioned
    FROM "Alert" a GROUP BY a."ruleKey"`;
  return new Map(rows.map((r) => [r.ruleKey, r]));
}

export type { TraceNode };
