import { json, route } from "@/lib/api";
import { updateDeclaredProfile } from "@/lib/domain/merchants/profile";

/** PATCH /merchants/:id/profile — update the declared profile with a reason; re-scores (SENIOR_ANALYST+). */
export const PATCH = route<{ id: string }>({ cap: "merchant.rescore" }, async (req, { params, user }) => {
  const r = await updateDeclaredProfile({ id: user.id, role: user.role }, params.id, await req.json());
  return json({ score: r.score, band: r.band, previousBand: r.previousBand });
});
