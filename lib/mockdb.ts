import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Starts the embedded mock database once per server process: PGlite loaded from
 * `.mock-db/sentinel.tar.gz` (built by `npm run mock:build`), exposed on a local socket so Prisma
 * talks to it like any Postgres. Called from instrumentation.ts before the first request.
 */
type Started = { startedAt: number; ms: number };

/** Identifies this server's copy of the demo data; a new one means the data was reset. */
export const DEMO_INSTANCE = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
    // Port 0: the OS picks a free port, so several server processes can share a machine.
    const server = new PGLiteSocketServer({ db: pg, port: 0, host: "127.0.0.1", maxConnections: 8 });
    await server.start();
    const addr = (server as unknown as { port: number }).port;
    process.env.SENTINEL_MOCK_PORT = String(addr);
    const ms = Date.now() - t0;
    console.log(`[sentinel] demo mode: embedded mock database ready on :${addr} in ${ms} ms`);
    return { startedAt: Date.now(), ms };
  })();
  return g.__sentinelMock;
}
