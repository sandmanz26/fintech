/**
 * npm run demo:advance-day [-- --days N]
 * Moves the simulated "today" forward one day at a time and runs every job.
 */
import { advanceOneDay } from "@/lib/jobs";
import { db } from "@/lib/db";

async function main() {
  const i = process.argv.indexOf("--days");
  const days = i > -1 ? Math.max(1, Number(process.argv[i + 1]) || 1) : 1;
  for (let n = 0; n < days; n++) {
    const t0 = Date.now();
    const r = await advanceOneDay();
    console.log(`Closed ${r.closed}; today is now ${r.today} (${Date.now() - t0} ms)`);
  }
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
