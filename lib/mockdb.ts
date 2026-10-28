import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { MOCK_PORT } from "./mode";

/**
 * Starts the embedded mock database once per server process: PGlite loaded from
 * `.mock-db/sentinel.tar.gz` (built by `npm run mock:build`), exposed on a local socket so Prisma
 * talks to it like any Postgres. Called from instrumentation.ts before the first request.
 */
type Started = { startedAt: number; ms: number };
const g = globalThis as unknown as { __sentinelMock?: Promise<Started> };

export function startMockDatabase(): Promise<Started> {
  g.__sentinelMock ??= (async () => {
    const t0 = Date.now();
    const file = path.join(process.cwd(), ".mock-db", "sentinel.tar.gz");
    if (!existsSync(file)) throw new Error(`Mock database snapshot not found at ${file}. Run \`npm run mock:build\` first.`);
    const { PGlite } = await import("@electric-sql/pglite");
    const { PGLiteSocketServer } = await import("@electric-sql/pglite-socket");
    const pg = await PGlite.create({
      loadDataDir: new Blob([readFileSync(file)]),
      startParams: [...PGlite.defaultStartParams, "-c", "max_wal_size=48MB", "-c", "min_wal_size=32MB"],
    });
    const server = new PGLiteSocketServer({ db: pg, port: MOCK_PORT, host: "127.0.0.1", maxConnections: 8 });
    await server.start();
    const ms = Date.now() - t0;
    console.log(`[sentinel] demo mode: embedded mock database ready in ${ms} ms`);
    return { startedAt: Date.now(), ms };
  })();
  return g.__sentinelMock;
}
