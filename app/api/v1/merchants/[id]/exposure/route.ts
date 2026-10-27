import { json, route } from "@/lib/api";
import { merchantExposure } from "@/lib/domain/controls/service";

/** GET /merchants/:id/exposure — the calculator, component by component (PRD §8 example shape). */
export const GET = route<{ id: string }>({ cap: "merchant.read" }, async (_req, { params }) => {
  const e = await merchantExposure(params.id);
  return json({
    currency: e.currency,
    adv: e.adv,
    advSource: e.advSource,
    components: {
      futureDelivery: { value: e.futureDelivery, formula: e.formulas.futureDelivery },
      disputeExposure: { value: e.disputeExposure, formula: e.formulas.disputeExposure },
    },
    totalExposure: e.totalExposure,
    reserveBalance: e.reserveBalance,
    coverage: Math.round(e.coverage * 1000) / 1000,
  });
});
