import { json, route, toActor } from "@/lib/api";
import { rescoreMerchant } from "@/lib/domain/scoring/service";

/** POST /merchants/:id/rescore — manual re-score with the active policy (SENIOR_ANALYST+). */
export const POST = route<{ id: string }>({ cap: "merchant.rescore" }, async (_req, { params, user }) => {
  const r = await rescoreMerchant(params.id, "MANUAL", toActor(user));
  return json({ score: r.score, band: r.band, previousBand: r.previousBand, policyVersion: r.policyVersion });
});
