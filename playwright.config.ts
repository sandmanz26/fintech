import { defineConfig } from "@playwright/test";
import { execSync } from "node:child_process";

/**
 * Each run gets its own database cloned from a seeded template (default `sentinel_tpl`; create it
 * once with `npm run seed:template`). Tests then mutate freely without touching dev data, and the
 * clone is dropped afterwards (set E2E_KEEP_DB=1 to keep it).
 */
const PG = process.env.E2E_PG ?? "postgresql://postgres:postgres@localhost:5432";
const TEMPLATE = process.env.E2E_TEMPLATE ?? "sentinel_tpl";
if (!process.env.E2E_DB) {
  process.env.E2E_DB = `sentinel_e2e_${Date.now()}`;
  process.env.E2E_DB_CREATED = "1";
  execSync(`psql "${PG}/postgres" -qc 'CREATE DATABASE ${process.env.E2E_DB} TEMPLATE ${TEMPLATE}'`, { stdio: "inherit" });
}
export const E2E_DATABASE_URL = `${PG}/${process.env.E2E_DB}?schema=public`;
process.env.E2E_DATABASE_URL = E2E_DATABASE_URL;
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "tests/e2e",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure", timezoneId: "Asia/Jakarta" },
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: { DATABASE_URL: E2E_DATABASE_URL, NEXT_DIST_DIR: ".next-e2e", AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-secret-e2e-secret-e2e-secret-1234", AUTH_TRUST_HOST: "true", LOG_LEVEL: "warn", STORAGE_DIR: "./storage" },
  },
});
