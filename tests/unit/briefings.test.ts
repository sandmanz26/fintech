import { describe, it, expect } from "vitest";
import { DEFAULT_RULES } from "@/lib/domain/rules/defaults";
import { SYSTEM_RULES } from "@/lib/domain/rules/system";
import { RULE_EXPLAIN, CASE_TYPE_EXPLAIN, STORY_BRIEFS } from "@/lib/demo/briefings";
import { CaseType } from "@prisma/client";

describe("first-time explanations", () => {
  it("every rule, default and system, is explained in both languages", () => {
    for (const key of [...DEFAULT_RULES.map((r) => r.key), ...SYSTEM_RULES.map((r) => r.key)]) {
      const e = RULE_EXPLAIN[key];
      expect(e, key).toBeDefined();
      for (const f of [e.what, e.why, e.act]) expect(f.id.length && f.en.length, key).toBeTruthy();
    }
  });
  it("every case type is explained", () => {
    for (const t of Object.values(CaseType)) expect(CASE_TYPE_EXPLAIN[t], t).toBeDefined();
  });
  it("every story has a briefing with steps and an outcome", () => {
    for (const [k, b] of Object.entries(STORY_BRIEFS)) {
      expect(b.steps.length, k).toBeGreaterThan(0);
      expect(b.done.id && b.done.en, k).toBeTruthy();
    }
  });
});
