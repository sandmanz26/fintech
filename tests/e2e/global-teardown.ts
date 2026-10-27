import { execSync } from "node:child_process";

/** Drop the database this run cloned, unless E2E_KEEP_DB is set (to inspect a failure). */
export default function globalTeardown() {
  const name = process.env.E2E_DB;
  if (!name || process.env.E2E_DB_CREATED !== "1" || process.env.E2E_KEEP_DB) return;
  const PG = process.env.E2E_PG ?? "postgresql://postgres:postgres@localhost:5432";
  execSync(`psql "${PG}/postgres" -qc 'DROP DATABASE IF EXISTS ${name} WITH (FORCE)'`, { stdio: "inherit" });
}
