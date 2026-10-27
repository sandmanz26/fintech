import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      // The pure engines the PRD names (§10). Their DB-backed services are covered by
      // tests/integration and tests/e2e against a real database.
      include: [
        "lib/domain/scoring/index.ts",
        "lib/domain/rules/dsl.ts",
        "lib/domain/reserves/calc.ts",
        "lib/domain/merchantStateMachine.ts",
        "lib/domain/caseStateMachine.ts",
        "lib/domain/approvals/policy.ts",
        "lib/domain/audit/hash.ts",
        "lib/money.ts",
      ],
      thresholds: { lines: 90, functions: 90, statements: 90 },
    },
  },
});
