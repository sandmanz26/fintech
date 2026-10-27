import { z } from "zod";

/**
 * Monitoring rule DSL (PRD §6.3). JSON in, a boolean and a trace out.
 * The evaluator is a plain recursive interpreter: no eval, no Function, no dynamic code.
 *
 * Ratios are fractions (0.0075 = 0.75%). Money metrics are minor units.
 */

export const METRICS = {
  gross_volume_1d: { label: "Volume today", unit: "money" },
  gross_volume_7d: { label: "Volume, 7 days", unit: "money" },
  gross_volume_30d: { label: "Volume, 30 days", unit: "money" },
  avg_gross_volume_30d: { label: "Average daily volume, 30 days", unit: "money" },
  settled_count_1d: { label: "Settled transactions today", unit: "count" },
  settled_count_30d: { label: "Settled transactions, 30 days", unit: "count" },
  chargeback_count_30d: { label: "Chargebacks, 30 days", unit: "count" },
  cb_ratio_30d: { label: "Chargeback ratio, 30 days", unit: "ratio" },
  refund_ratio_30d: { label: "Refund ratio, 30 days", unit: "ratio" },
  decline_rate_1d: { label: "Decline rate today", unit: "ratio" },
  auth_attempts_1d: { label: "Authorisation attempts today", unit: "count" },
  small_auth_count_1d: { label: "Very small authorisations today", unit: "count" },
  avg_ticket_7d: { label: "Average ticket, 7 days", unit: "money" },
  expected_avg_ticket: { label: "Declared average ticket", unit: "money" },
  expected_monthly_volume: { label: "Declared monthly volume", unit: "money" },
  volume_vs_expected_monthly: { label: "30-day volume vs declared monthly", unit: "ratio" },
  cross_border_pct_7d: { label: "Cross-border share, 7 days", unit: "ratio" },
  days_since_last_txn: { label: "Days since last transaction", unit: "days" },
  is_domestic: { label: "Domestic merchant (1 = yes)", unit: "flag" },
  network_cb_threshold: { label: "Network chargeback threshold (policy)", unit: "ratio" },
  vol_spike_alerts_14d: { label: "Volume-spike alerts, 14 days", unit: "count" },
} as const;

export type MetricKey = keyof typeof METRICS;
export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];
export type MetricContext = Partial<Record<MetricKey, number | null>>;

export type ValueExpr =
  | number
  | { metric: MetricKey }
  | { mul: ValueExpr[] }
  | { add: ValueExpr[] }
  | { sub: ValueExpr[] }
  | { div: ValueExpr[] };

export type Op = ">" | ">=" | "<" | "<=" | "==" | "!=" | "between" | "in";

export type Leaf = { metric: MetricKey; op: Op; value: ValueExpr | ValueExpr[] };
export type Condition = { all: Condition[] } | { any: Condition[] } | { not: Condition } | Leaf;

const metricKey = z.enum(METRIC_KEYS as [MetricKey, ...MetricKey[]]);

export const ValueExprSchema: z.ZodType<ValueExpr> = z.lazy(() =>
  z.union([
    z.number().finite(),
    z.object({ metric: metricKey }).strict(),
    z.object({ mul: z.array(ValueExprSchema).min(2) }).strict(),
    z.object({ add: z.array(ValueExprSchema).min(2) }).strict(),
    z.object({ sub: z.array(ValueExprSchema).min(2) }).strict(),
    z.object({ div: z.array(ValueExprSchema).length(2) }).strict(),
  ]),
);

const LeafSchema = z
  .object({
    metric: metricKey,
    op: z.enum([">", ">=", "<", "<=", "==", "!=", "between", "in"]),
    value: z.union([ValueExprSchema, z.array(ValueExprSchema)]),
  })
  .strict()
  .superRefine((leaf, ctx) => {
    if (leaf.op === "between" && !(Array.isArray(leaf.value) && leaf.value.length === 2)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "`between` needs [low, high]" });
    }
    if (leaf.op === "in" && !(Array.isArray(leaf.value) && leaf.value.length > 0 && leaf.value.every((v) => typeof v === "number"))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "`in` needs a non-empty list of numbers" });
    }
    if (leaf.op !== "between" && leaf.op !== "in" && Array.isArray(leaf.value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `\`${leaf.op}\` needs a single value` });
    }
  });

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(ConditionSchema).min(1) }).strict(),
    z.object({ any: z.array(ConditionSchema).min(1) }).strict(),
    z.object({ not: ConditionSchema }).strict(),
    LeafSchema,
  ]),
) as z.ZodType<Condition>;

export const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const MERCHANT_STATUSES_MONITORED = ["ACTIVE", "UNDER_REVIEW", "RESTRICTED"] as const;

export const RuleDefinitionSchema = z
  .object({
    key: z.string().regex(/^R-[A-Z0-9-]+$/, "Keys look like R-VOL-SPIKE"),
    scope: z.literal("merchant_daily"),
    when: ConditionSchema,
    filters: z
      .object({
        merchantStatus: z.array(z.string()).min(1).default(["ACTIVE", "UNDER_REVIEW"]),
        minAgeDays: z.number().int().min(0).default(0),
      })
      .default({}),
    severity: z.enum(SEVERITIES),
    dedupe: z
      .object({
        windowHours: z.number().int().min(1).default(24),
        keyTemplate: z.string().default("{ruleKey}:{merchantId}:{date}"),
      })
      .default({}),
    autoCase: z
      .object({
        enabled: z.boolean(),
        caseType: z.enum(["UNDERWRITING", "MONITORING", "DISPUTE_SPIKE", "WATCHLIST", "RFI_FOLLOWUP", "OFFBOARDING"]).default("MONITORING"),
        priority: z.enum(SEVERITIES).optional(),
        slaHours: z.number().positive().optional(),
      })
      .default({ enabled: false, caseType: "MONITORING" }),
    evidenceMetrics: z.array(metricKey).default([]),
  })
  .strict();

export type RuleDefinition = z.infer<typeof RuleDefinitionSchema>;

// ---------------------------------------------------------------------------

export function evalValue(v: ValueExpr, m: MetricContext): number | null {
  if (typeof v === "number") return v;
  if ("metric" in v) {
    const x = m[v.metric];
    return x === undefined || x === null || Number.isNaN(x) ? null : x;
  }
  const fold = (xs: ValueExpr[], fn: (a: number, b: number) => number | null): number | null => {
    let acc = evalValue(xs[0], m);
    for (let i = 1; i < xs.length; i++) {
      const b = evalValue(xs[i], m);
      if (acc === null || b === null) return null;
      acc = fn(acc, b);
    }
    return acc;
  };
  if ("mul" in v) return fold(v.mul, (a, b) => a * b);
  if ("add" in v) return fold(v.add, (a, b) => a + b);
  if ("sub" in v) return fold(v.sub, (a, b) => a - b);
  if ("div" in v) return fold(v.div, (a, b) => (b === 0 ? null : a / b));
  return null;
}

export type TraceNode =
  | { kind: "leaf"; metric: MetricKey; op: Op; actual: number | null; expected: number | number[] | null; result: boolean }
  | { kind: "all" | "any"; result: boolean; children: TraceNode[] }
  | { kind: "not"; result: boolean; child: TraceNode };

/** Small epsilon so 0.1 + 0.2 style float noise never flips a comparison on a ratio. */
const EPS = 1e-9;

function compare(op: Op, a: number, b: number): boolean {
  switch (op) {
    case ">":
      return a > b + EPS;
    case ">=":
      return a >= b - EPS;
    case "<":
      return a < b - EPS;
    case "<=":
      return a <= b + EPS;
    case "==":
      return Math.abs(a - b) <= EPS;
    case "!=":
      return Math.abs(a - b) > EPS;
    default:
      return false;
  }
}

export function evalCondition(c: Condition, m: MetricContext): TraceNode {
  if ("all" in c) {
    const children = c.all.map((x) => evalCondition(x, m));
    return { kind: "all", result: children.every((x) => x.result), children };
  }
  if ("any" in c) {
    const children = c.any.map((x) => evalCondition(x, m));
    return { kind: "any", result: children.some((x) => x.result), children };
  }
  if ("not" in c) {
    const child = evalCondition(c.not, m);
    return { kind: "not", result: !child.result, child };
  }
  const actual = evalValue({ metric: c.metric }, m);
  if (c.op === "between") {
    const [lo, hi] = (c.value as ValueExpr[]).map((x) => evalValue(x, m));
    const ok = actual !== null && lo !== null && hi !== null && actual >= lo - EPS && actual <= hi + EPS;
    return { kind: "leaf", metric: c.metric, op: c.op, actual, expected: lo !== null && hi !== null ? [lo, hi] : null, result: ok };
  }
  if (c.op === "in") {
    const list = c.value as number[];
    const ok = actual !== null && list.some((x) => Math.abs(x - actual) <= EPS);
    return { kind: "leaf", metric: c.metric, op: c.op, actual, expected: list, result: ok };
  }
  const expected = evalValue(c.value as ValueExpr, m);
  const ok = actual !== null && expected !== null && compare(c.op, actual, expected);
  return { kind: "leaf", metric: c.metric, op: c.op, actual, expected, result: ok };
}

export type RuleSubject = { merchantId: string; status: string; ageDays: number; date: string };

export type RuleEvaluation = {
  fired: boolean;
  filteredOut: false | "status" | "age";
  trace: TraceNode | null;
  evidence: Record<string, number | null>;
};

/** Evaluate one rule for one merchant-day. Pure. */
export function evaluateRule(def: RuleDefinition, subject: RuleSubject, metrics: MetricContext): RuleEvaluation {
  if (!def.filters.merchantStatus.includes(subject.status)) {
    return { fired: false, filteredOut: "status", trace: null, evidence: {} };
  }
  if (subject.ageDays < def.filters.minAgeDays) {
    return { fired: false, filteredOut: "age", trace: null, evidence: {} };
  }
  const trace = evalCondition(def.when, metrics);
  const evidence: Record<string, number | null> = {};
  for (const k of collectMetrics(def.when)) evidence[k] = metrics[k] ?? null;
  for (const k of def.evidenceMetrics) evidence[k] = metrics[k] ?? null;
  return { fired: trace.result, filteredOut: false, trace, evidence };
}

export function collectMetrics(c: Condition, out = new Set<MetricKey>()): Set<MetricKey> {
  if ("all" in c) c.all.forEach((x) => collectMetrics(x, out));
  else if ("any" in c) c.any.forEach((x) => collectMetrics(x, out));
  else if ("not" in c) collectMetrics(c.not, out);
  else {
    out.add(c.metric);
    const visit = (v: ValueExpr) => {
      if (typeof v === "number") return;
      if ("metric" in v) out.add(v.metric);
      else Object.values(v).forEach((xs) => (xs as ValueExpr[]).forEach(visit));
    };
    (Array.isArray(c.value) ? c.value : [c.value]).forEach(visit);
  }
  return out;
}

export function dedupeKey(def: RuleDefinition, subject: RuleSubject): string {
  return def.dedupe.keyTemplate
    .replaceAll("{ruleKey}", def.key)
    .replaceAll("{merchantId}", subject.merchantId)
    .replaceAll("{date}", subject.date);
}

/** Constants read in the metric's unit: minor units as dollars, ratios as percentages. */
function constant(v: number, unit: string): string {
  if (unit === "money") return `$${(v / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (unit === "ratio" && v < 1) return `${+(v * 100).toFixed(3)}%`;
  return String(v);
}

/** Human-readable sentence for a condition, used in Rules Studio and alert evidence. */
export function describeCondition(c: Condition): string {
  if ("all" in c) return c.all.map(describeCondition).join(" and ");
  if ("any" in c) return `(${c.any.map(describeCondition).join(" or ")})`;
  if ("not" in c) return `not (${describeCondition(c.not)})`;
  const label = METRICS[c.metric].label.toLowerCase();
  const unit = METRICS[c.metric].unit;
  // Constants that stand for the metric (bare, or added/subtracted) take its unit; factors in a
  // product or quotient are plain numbers ("3 × average daily volume").
  const val = (v: ValueExpr, inUnit = true): string => {
    if (typeof v === "number") return inUnit ? constant(v, unit) : String(v);
    if ("metric" in v) return METRICS[v.metric].label.toLowerCase();
    if ("mul" in v) return v.mul.map((x) => val(x, false)).join(" × ");
    if ("add" in v) return v.add.map((x) => val(x, inUnit)).join(" + ");
    if ("sub" in v) return v.sub.map((x) => val(x, inUnit)).join(" − ");
    if ("div" in v) return v.div.map((x) => val(x, false)).join(" ÷ ");
    return "?";
  };
  if (c.op === "between") {
    const [a, b] = c.value as ValueExpr[];
    return `${label} between ${val(a)} and ${val(b)}`;
  }
  if (c.op === "in") return `${label} in ${(c.value as number[]).map((x) => constant(x, unit)).join(", ")}`;
  return `${label} ${c.op} ${val(c.value as ValueExpr)}`;
}
