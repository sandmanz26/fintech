import { execSync } from "node:child_process";

/** The config clones the template; this drops the clone after the run unless E2E_KEEP_DB is set. */
export default function setup() {
  return () => {
    const name = process.env.IT_DB;
    if (!name || process.env.E2E_KEEP_DB) return;
    const PG = process.env.E2E_PG ?? "postgresql://postgres:postgres@localhost:5432";
    execSync(`psql "${PG}/postgres" -qc 'DROP DATABASE IF EXISTS ${name} WITH (FORCE)'`);
  };
}
