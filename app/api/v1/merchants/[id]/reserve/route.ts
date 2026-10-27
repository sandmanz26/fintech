import { db } from "@/lib/db";
import { json, route } from "@/lib/api";
import { reserveBalances } from "@/lib/domain/controls/service";

/** GET /merchants/:id/reserve — balance (derived from the ledger) and the ledger itself. */
export const GET = route<{ id: string }>({ cap: "merchant.read" }, async (_req, { params }) => {
  const [bal, entries] = await Promise.all([
    reserveBalances(params.id),
    db.reserveLedgerEntry.findMany({ where: { merchantId: params.id }, orderBy: [{ sourceDate: "desc" }, { createdAt: "desc" }], take: 500 }),
  ]);
  return json({ balance: bal.total, perControl: Object.fromEntries([...bal.perControl].map(([k, v]) => [k, v.balance])), entries });
});
