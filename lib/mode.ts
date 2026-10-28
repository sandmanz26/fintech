/**
 * Demo mode: no database server. When DATABASE_URL is not set, the app runs on an embedded
 * Postgres (PGlite, compiled to WebAssembly) loaded from a seeded snapshot of mock data. Every
 * service, rule and audit check runs unchanged; changes live in memory and reset on a cold start.
 * Edge-safe (no imports), so the middleware can read it too.
 */
export const isMockMode = () => process.env.SENTINEL_MOCK === "1" || !process.env.DATABASE_URL || process.env.DATABASE_URL.startsWith(`postgresql://mock@`);
/** The embedded database listens on a free port picked at start (lib/mockdb.ts sets it). */
export const mockDatabaseUrl = () => `postgresql://postgres:postgres@127.0.0.1:${process.env.SENTINEL_MOCK_PORT ?? "54329"}/postgres?sslmode=disable&connection_limit=4&pool_timeout=60`;
