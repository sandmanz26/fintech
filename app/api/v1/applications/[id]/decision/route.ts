import { json, route } from "@/lib/api";
import { decideApplication } from "@/lib/domain/underwriting/service";

/**
 * POST /applications/:id/decision — { decision, reasonCode, note, controls?[], rfi? }.
 * Band routing is enforced in the service: HIGH needs SENIOR_ANALYST+, PROHIBITED only declines
 * or goes to an OVERRIDE_PROHIBITED approval.
 */
export const POST = route<{ id: string }>({ cap: "underwriting.decide.standard" }, async (req, { params, user }) => {
  const r = await decideApplication({ id: user.id, role: user.role }, params.id, await req.json().catch(() => ({})));
  return json(r);
});
