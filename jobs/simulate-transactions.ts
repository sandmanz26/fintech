/**
 * npm run simulate -- --date 2026-10-27
 * Generate one day of transactions (normal and story patterns) without running the other jobs.
 */
import { simulateDay } from "@/lib/sim/simulator";
import { simToday } from "@/lib/clock";
import { db } from "@/lib/db";

async function main() {
  const i = process.argv.indexOf("--date");
  const day = i > -1 ? new Date(`${process.argv[i + 1]}T00:00:00Z`) : await simToday();
  const r = await simulateDay(day);
  console.log(`Simulated ${day.toISOString().slice(0, 10)}: ${r.transactions} transactions, ${r.disputes} disputes scheduled`);
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
