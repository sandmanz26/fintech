/**
 * Background worker (PRD §4.2): pg-boss on the same Postgres, no Redis.
 * Schedules: metrics 00:30 UTC, then rules and reserves; SLA checker every 15 minutes.
 * In the demo, `npm run demo:advance-day` runs the same functions directly.
 */
import PgBoss from "pg-boss";
import { closeDay, openDay, withJobRun } from "@/lib/jobs";
import { runSlaChecker } from "@/lib/domain/cases/service";
import { simToday } from "@/lib/clock";
import { addDays } from "@/lib/domain/reserves/calc";
import { logger } from "@/lib/logger";

async function main() {
  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, schema: "pgboss" });
  boss.on("error", (e) => logger.error({ err: e }, "pg-boss error"));
  await boss.start();

  const queues = ["close-day", "open-day", "sla-checker"] as const;
  for (const q of queues) await boss.createQueue(q);

  await boss.schedule("close-day", "30 0 * * *", {}, { tz: "UTC" });
  await boss.schedule("open-day", "45 0 * * *", {}, { tz: "UTC" });
  await boss.schedule("sla-checker", "*/15 * * * *", {}, { tz: "UTC" });

  // Jobs read the simulated calendar: "yesterday" relative to the sim clock.
  await boss.work("close-day", async () => closeDay(addDays(await simToday(), -1)));
  await boss.work("open-day", async () => openDay(await simToday()));
  await boss.work("sla-checker", async () => withJobRun("sla-checker", () => runSlaChecker(), (r) => r.breached));

  logger.info("worker started");
}

main().catch((e) => {
  logger.error({ err: e }, "worker crashed");
  process.exit(1);
});
