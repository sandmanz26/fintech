/**
 * Demo mode: no database server. The app runs on an embedded Postgres (PGlite, compiled to
 * WebAssembly) loaded from a seeded snapshot of mock data. Every service, rule and audit check
 * runs unchanged; changes live in memory and reset on a cold start.
 *
 * - On Vercel, demo mode is the default: a deployment works with no settings at all, and a
 *   DATABASE_URL left over in the project is ignored. SENTINEL_MODE=database opts into a real one.
 * - Elsewhere, a DATABASE_URL means a real database; without one, demo mode.
 * - SENTINEL_MOCK=1 forces demo mode; SENTINEL_MODE=database forces a real database.
 */
export const isMockMode = () => {
  if (process.env.SENTINEL_MOCK === "1") return true;
  if (process.env.SENTINEL_MODE === "database") return false;
  if (process.env.VERCEL === "1") return true;
  return !process.env.DATABASE_URL;
};

/** The embedded database listens on a free port picked at start (lib/mockdb.ts sets it). */
export const mockDatabaseUrl = () => `postgresql://postgres:postgres@127.0.0.1:${process.env.SENTINEL_MOCK_PORT ?? "54329"}/postgres?sslmode=disable&connection_limit=4&pool_timeout=60`;
