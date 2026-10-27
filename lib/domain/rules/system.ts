import type { CaseType, Prisma, Severity } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { record, SYSTEM_ACTOR } from "@/lib/domain/audit";
import { routeAlert } from "@/lib/domain/cases/service";
import { utcDay } from "@/lib/domain/reserves/calc";
import type { RuleDefinition } from "./dsl";

/**
 * System rules: alerts raised by pipelines other than the daily metric evaluation (control limits,
 * rescreening, website monitoring). Each is a Rule row so alerts keep a ruleVersionId and show in
 * rule statistics, but none is evaluated on metrics and none can be edited or switched off.
 */
export const SYSTEM_RULES: { key: string; name: string; description: string; severity: Severity; caseType: CaseType; slaHours?: number }[] = [
  {
    key: "R-LIMIT-BREACH",
    name: "Control limit exceeded",
    description: "Raised by the transaction pipeline when a volume limit or maximum-ticket control is exceeded.",
    severity: "MEDIUM",
    caseType: "MONITORING",
  },
  {
    key: "R-WATCHLIST-RESCREEN",
    name: "New watchlist match on rescreening",
    description:
      "Raised by ongoing screening (monthly, and whenever a list update is published) when an owner of a processing merchant matches a sanctions, PEP or terminated-merchant entry for the first time.",
    severity: "HIGH",
    caseType: "WATCHLIST",
    slaHours: 24,
  },
  {
    key: "R-WEBSITE-CHANGE",
    name: "Website changed",
    description:
      "Raised by weekly website monitoring when a merchant's site goes offline, drops its refund policy, terms or contact details, or starts showing restricted products (the transaction-laundering pattern).",
    severity: "HIGH",
    caseType: "MONITORING",
    slaHours: 24,
  },
];

export const SYSTEM_RULE_KEYS = new Set(SYSTEM_RULES.map((r) => r.key));

/** A definition that never matches on metrics (volume below zero), kept for schema validity. */
export function systemRuleDefinition(r: (typeof SYSTEM_RULES)[number]): RuleDefinition {
  return {
    key: r.key,
    scope: "merchant_daily",
    when: { metric: "gross_volume_1d", op: "<", value: 0 },
    severity: r.severity,
    filters: { merchantStatus: ["ACTIVE"], minAgeDays: 0 },
    dedupe: { windowHours: 24, keyTemplate: "{ruleKey}:{merchantId}:{date}" },
    autoCase: { enabled: true, caseType: r.caseType, priority: r.severity, slaHours: r.slaHours },
    evidenceMetrics: [],
  };
}

/** Raise a system alert and route it to a case. Returns null when the dedupe key already exists. */
export async function raiseSystemAlert(
  tx: Tx,
  input: { ruleKey: string; merchantId: string; day: Date; dedupeKey: string; evidence: Record<string, unknown>; severity?: Severity },
): Promise<string | null> {
  const def = SYSTEM_RULES.find((r) => r.key === input.ruleKey);
  if (!def) throw new Error(`Unknown system rule ${input.ruleKey}`);
  const rule = await tx.rule.findUnique({ where: { key: input.ruleKey } });
  if (!rule?.activeVersionId) return null;
  if (await tx.alert.findUnique({ where: { dedupeKey: input.dedupeKey }, select: { id: true } })) return null;
  const severity = input.severity ?? def.severity;
  const alert = await tx.alert.create({
    data: {
      merchantId: input.merchantId,
      ruleVersionId: rule.activeVersionId,
      ruleKey: input.ruleKey,
      severity,
      dedupeKey: input.dedupeKey,
      metricDate: utcDay(input.day),
      evidence: input.evidence as Prisma.InputJsonValue,
    },
  });
  await record(tx, SYSTEM_ACTOR, { action: "ALERT_CREATED", entityType: "Alert", entityId: alert.id, after: { ruleKey: input.ruleKey, merchantId: input.merchantId } });
  await routeAlert(tx, alert, { enabled: true, caseType: def.caseType, priority: severity, slaHours: def.slaHours }, def.name);
  return alert.id;
}
