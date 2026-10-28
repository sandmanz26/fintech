/**
 * Builds the embedded mock database (no backend needed): an in-memory PGlite (Postgres compiled to
 * WebAssembly) behind a local socket, migrated and seeded with the same deterministic seed as a
 * real database, then saved as a compressed data directory the app loads at start.
 *
 *   node scripts/build-mock-db.mjs            -> .mock-db/sentinel.tar.gz
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const PORT = 54398;
const url = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres?sslmode=disable&connection_limit=1`;
const t0 = Date.now();
// A small WAL budget: checkpoints recycle the log instead of keeping ~1 GB of it in the snapshot.
const db = await PGlite.create({ startParams: [...PGlite.defaultStartParams, "-c", "max_wal_size=48MB", "-c", "min_wal_size=32MB"] });
const server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1", maxConnections: 4 });
await server.start();

// Async on purpose: the socket server answers on this process's event loop.
const run = (cmd, args) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit", env: { ...process.env, SENTINEL_MOCK: "", DATABASE_URL: url, STORAGE_DIR: ".mock-db/storage", LOG_LEVEL: "warn" } });
    child.on("exit", (code) => {
      if (code !== 0) {
        console.error(`${cmd} ${args.join(" ")} failed`);
        process.exit(1);
      }
      resolve();
    });
  });
await run("npx", ["prisma", "migrate", "deploy"]);
await run("npx", ["tsx", "prisma/seed.ts"]);

await server.stop();
// Keep it light enough for a serverless cold start: raw transactions older than 45 days go,
// unless a dispute or fraud report points at them. Charts, ratios and rules read the daily
// aggregates (DailyMerchantMetric), which keep the full 120 days.
const pruned = await db.query(`
  DELETE FROM "Transaction" t
  WHERE t."occurredAt" < (SELECT "today" FROM "SimClock" LIMIT 1) - INTERVAL '45 days'
    AND NOT EXISTS (SELECT 1 FROM "Dispute" d WHERE d."transactionId" = t.id)
    AND NOT EXISTS (SELECT 1 FROM "FraudReport" f WHERE f."transactionId" = t.id)`);
console.log(`pruned ${pruned.affectedRows} raw transactions older than 45 days`);
await db.exec("VACUUM FULL");
await db.exec("ANALYZE");
for (let i = 0; i < 3; i++) await db.exec("CHECKPOINT");
const blob = await db.dumpDataDir("gzip");
mkdirSync(".mock-db", { recursive: true }); // seeded documents are already in .mock-db/storage
writeFileSync(".mock-db/sentinel.tar.gz", Buffer.from(await blob.arrayBuffer()));
console.log(`mock database ready: ${(blob.size / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
await db.close();
