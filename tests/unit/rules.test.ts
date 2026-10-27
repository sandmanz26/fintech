import { describe, it, expect } from "vitest";
import {
  evalValue,
  evalCondition,
  evaluateRule,
  dedupeKey,
  describeCondition,
  collectMetrics,
  RuleDefinitionSchema,
  ConditionSchema,
  type Condition,
  type RuleDefinition,
} from "@/lib/domain/rules/dsl";
import { DEFAULT_RULES } from "@/lib/domain/rules/defaults";
import { readFileSync } from "node:fs";

const subject = { merchantId: "m1", status: "ACTIVE", ageDays: 60, date: "2026-10-27" };
const rule = (key: string): RuleDefinition => RuleDefinitionSchema.parse(DEFAULT_RULES.find((r) => r.key === key)!.definition);

describe("value expressions", () => {
  const m = { gross_volume_1d: 900, avg_gross_volume_30d: 200, cb_ratio_30d: null };
  it("numbers and metrics", () => {
    expect(evalValue(5, m)).toBe(5);
    expect(evalValue({ metric: "gross_volume_1d" }, m)).toBe(900);
    expect(evalValue({ metric: "cb_ratio_30d" }, m)).toBeNull();
    expect(evalValue({ metric: "gross_volume_7d" }, m)).toBeNull();
  });
  it("mul, add, sub, div with metric operands", () => {
    expect(evalValue({ mul: [3, { metric: "avg_gross_volume_30d" }] }, m)).toBe(600);
    expect(evalValue({ add: [1, 2, 3] }, m)).toBe(6);
    expect(evalValue({ sub: [{ metric: "gross_volume_1d" }, 100] }, m)).toBe(800);
    expect(evalValue({ div: [{ metric: "gross_volume_1d" }, 3] }, m)).toBe(300);
  });
  it("division by zero and missing operands yield null", () => {
    expect(evalValue({ div: [1, 0] }, m)).toBeNull();
    expect(evalValue({ mul: [2, { metric: "cb_ratio_30d" }] }, m)).toBeNull();
  });
});

describe("operators", () => {
  const m = { decline_rate_1d: 0.4 };
  const leaf = (op: string, value: unknown) => evalCondition({ metric: "decline_rate_1d", op, value } as Condition, m).result;
  it(">, >=, <, <=, ==, !=", () => {
    expect(leaf(">", 0.4)).toBe(false);
    expect(leaf(">", 0.39)).toBe(true);
    expect(leaf(">=", 0.4)).toBe(true);
    expect(leaf("<", 0.4)).toBe(false);
    expect(leaf("<", 0.41)).toBe(true);
    expect(leaf("<=", 0.4)).toBe(true);
    expect(leaf("==", 0.4)).toBe(true);
    expect(leaf("!=", 0.4)).toBe(false);
    expect(leaf("!=", 0.5)).toBe(true);
  });
  it("tolerates float noise (0.1 + 0.3 == 0.4)", () => {
    expect(evalCondition({ metric: "decline_rate_1d", op: "==", value: { add: [0.1, 0.3] } }, m).result).toBe(true);
  });
  it("between is inclusive", () => {
    expect(leaf("between", [0.4, 0.5])).toBe(true);
    expect(leaf("between", [0.1, 0.4])).toBe(true);
    expect(leaf("between", [0.41, 0.5])).toBe(false);
  });
  it("in", () => {
    expect(leaf("in", [0.1, 0.4])).toBe(true);
    expect(leaf("in", [0.1, 0.2])).toBe(false);
  });
  it("a missing metric never satisfies a comparison", () => {
    expect(evalCondition({ metric: "cb_ratio_30d", op: "<", value: 1 }, {}).result).toBe(false);
    expect(evalCondition({ metric: "cb_ratio_30d", op: "between", value: [0, 1] }, {}).result).toBe(false);
    expect(evalCondition({ metric: "cb_ratio_30d", op: "in", value: [0] }, {}).result).toBe(false);
  });
  it("unknown operator is rejected by the schema and is false at runtime", () => {
    expect(ConditionSchema.safeParse({ metric: "cb_ratio_30d", op: "~", value: 1 }).success).toBe(false);
    expect(evalCondition({ metric: "decline_rate_1d", op: "~" as never, value: 1 }, m).result).toBe(false);
  });
});

describe("composition", () => {
  const m = { gross_volume_1d: 10, decline_rate_1d: 0.5 };
  const a: Condition = { metric: "gross_volume_1d", op: ">", value: 5 };
  const b: Condition = { metric: "decline_rate_1d", op: ">", value: 0.9 };
  it("all / any / not", () => {
    expect(evalCondition({ all: [a, b] }, m).result).toBe(false);
    expect(evalCondition({ any: [a, b] }, m).result).toBe(true);
    expect(evalCondition({ not: b }, m).result).toBe(true);
    expect(evalCondition({ all: [a, { not: b }] }, m).result).toBe(true);
  });
  it("returns a trace for explanation", () => {
    const t = evalCondition({ all: [a, b] }, m);
    expect(t.kind).toBe("all");
    if (t.kind === "all") {
      expect(t.children[0]).toMatchObject({ kind: "leaf", actual: 10, expected: 5, result: true });
      expect(t.children[1]).toMatchObject({ kind: "leaf", actual: 0.5, expected: 0.9, result: false });
    }
  });
});

describe("schema", () => {
  it("accepts all nine default rules", () => {
    expect(DEFAULT_RULES).toHaveLength(9);
    for (const r of DEFAULT_RULES) expect(RuleDefinitionSchema.safeParse(r.definition).success, r.key).toBe(true);
  });
  it("rejects unknown metrics, bad between, and arrays on scalar ops", () => {
    expect(ConditionSchema.safeParse({ metric: "nope", op: ">", value: 1 }).success).toBe(false);
    expect(ConditionSchema.safeParse({ metric: "cb_ratio_30d", op: "between", value: 1 }).success).toBe(false);
    expect(ConditionSchema.safeParse({ metric: "cb_ratio_30d", op: ">", value: [1, 2] }).success).toBe(false);
    expect(ConditionSchema.safeParse({ metric: "cb_ratio_30d", op: "in", value: [] }).success).toBe(false);
    expect(ConditionSchema.safeParse({ all: [] }).success).toBe(false);
  });
  it("rejects code-like strings anywhere (no eval path exists)", () => {
    expect(ConditionSchema.safeParse({ metric: "cb_ratio_30d", op: ">", value: "process.exit()" }).success).toBe(false);
  });
});

describe("evaluateRule with the default rules", () => {
  it("R-VOL-SPIKE fires above 3x average and the floor", () => {
    const r = rule("R-VOL-SPIKE");
    expect(evaluateRule(r, subject, { gross_volume_1d: 700_000, avg_gross_volume_30d: 200_000 }).fired).toBe(true);
    expect(evaluateRule(r, subject, { gross_volume_1d: 400_000, avg_gross_volume_30d: 100_000 }).fired).toBe(false); // under floor
    expect(evaluateRule(r, subject, { gross_volume_1d: 590_000, avg_gross_volume_30d: 200_000 }).fired).toBe(false);
  });
  it("R-CB-NETWORK-PROX uses the policy threshold metric", () => {
    const r = rule("R-CB-NETWORK-PROX");
    expect(evaluateRule(r, subject, { cb_ratio_30d: 0.0121, network_cb_threshold: 0.015, chargeback_count_30d: 40 }).fired).toBe(true);
    expect(evaluateRule(r, subject, { cb_ratio_30d: 0.0119, network_cb_threshold: 0.015, chargeback_count_30d: 40 }).fired).toBe(false);
    // Materiality floor: 4 chargebacks on a tiny merchant does not page anyone.
    expect(evaluateRule(r, subject, { cb_ratio_30d: 0.02, network_cb_threshold: 0.015, chargeback_count_30d: 4 }).fired).toBe(false);
  });
  it("R-CARD-TESTING", () => {
    const r = rule("R-CARD-TESTING");
    expect(evaluateRule(r, { ...subject, ageDays: 2 }, { small_auth_count_1d: 300, decline_rate_1d: 0.7 }).fired).toBe(true);
    expect(evaluateRule(r, subject, { small_auth_count_1d: 300, decline_rate_1d: 0.2 }).fired).toBe(false);
  });
  it("filters by status and age", () => {
    const r = rule("R-VOL-SPIKE");
    const m = { gross_volume_1d: 9_000_000, avg_gross_volume_30d: 1 };
    expect(evaluateRule(r, { ...subject, status: "TERMINATED" }, m)).toMatchObject({ fired: false, filteredOut: "status" });
    expect(evaluateRule(r, { ...subject, ageDays: 3 }, m)).toMatchObject({ fired: false, filteredOut: "age" });
  });
  it("collects evidence for every metric used and listed", () => {
    const r = rule("R-VOL-SPIKE");
    const ev = evaluateRule(r, subject, { gross_volume_1d: 700_000, avg_gross_volume_30d: 200_000, avg_ticket_7d: 5000 }).evidence;
    expect(ev).toEqual({ gross_volume_1d: 700_000, avg_gross_volume_30d: 200_000, avg_ticket_7d: 5000 });
  });
  it("dedupe key from template", () => {
    expect(dedupeKey(rule("R-VOL-SPIKE"), subject)).toBe("R-VOL-SPIKE:m1:2026-10-27");
  });
});

describe("helpers", () => {
  it("describeCondition reads as a sentence", () => {
    expect(describeCondition(rule("R-VOL-SPIKE").when)).toBe(
      "volume today > 3 × average daily volume, 30 days and volume today > 500000",
    );
    expect(describeCondition({ any: [{ metric: "cb_ratio_30d", op: "between", value: [0, 1] }, { not: { metric: "is_domestic", op: "in", value: [1] } }] })).toBe(
      "(chargeback ratio, 30 days between 0 and 1 or not (domestic merchant (1 = yes) in 1))",
    );
    expect(describeCondition({ metric: "gross_volume_1d", op: ">", value: { add: [1, { sub: [3, { div: [4, 2] }] }] } })).toContain("+");
  });
  it("collectMetrics finds metrics inside value expressions", () => {
    expect([...collectMetrics(rule("R-CB-NETWORK-PROX").when)].sort()).toEqual(["cb_ratio_30d", "chargeback_count_30d", "network_cb_threshold"]);
  });
});

describe("no dynamic code", () => {
  it("the rules engine source contains no eval or Function constructor", () => {
    const src = readFileSync("lib/domain/rules/dsl.ts", "utf8");
    expect(src).not.toMatch(/\beval\s*\(/);
    expect(src).not.toMatch(/new\s+Function\s*\(/);
  });
});
