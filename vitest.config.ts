import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: [
        "lib/domain/scoring/**",
        "lib/domain/rules/**",
        "lib/domain/reserves/**",
        "lib/domain/merchantStateMachine.ts",
        "lib/domain/caseStateMachine.ts",
        "lib/domain/approvals/policy.ts",
      ],
      thresholds: { lines: 90, functions: 90, statements: 90 },
    },
  },
});
