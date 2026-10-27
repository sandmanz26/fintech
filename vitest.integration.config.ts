import { defineConfig } from "vitest/config";
import path from "node:path";
import { execSync } from "node:child_process";

/** Integration tests run against a fresh clone of the seeded template database. */
const PG = process.env.E2E_PG ?? "postgresql://postgres:postgres@localhost:5432";
const db = `sentinel_it_${Date.now()}`;
process.env.IT_DB = db;
execSync(`psql "${PG}/postgres" -qc 'CREATE DATABASE ${db} TEMPLATE ${process.env.E2E_TEMPLATE ?? "sentinel_tpl"}'`);

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    // One shared clone: files must not mutate it at the same time.
    fileParallelism: false,
    environment: "node",
    testTimeout: 300_000,
    hookTimeout: 300_000,
    env: { DATABASE_URL: `${PG}/${db}?schema=public`, LOG_LEVEL: "silent", STORAGE_DIR: "./storage" },
  },
});
