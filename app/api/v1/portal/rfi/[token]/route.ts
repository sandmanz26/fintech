import { json, publicRoute, errorResponse } from "@/lib/api";
import { portalView } from "@/lib/domain/portal";
import { clientIp, limited } from "@/lib/rateLimit";

/** GET /portal/rfi/:token — public, token-gated; only merchant-safe fields. */
export const GET = publicRoute<{ token: string }>(async (req, { params }) => {
  const tooMany = limited([{ key: `portal:get:${clientIp(req)}`, limit: 60, windowMs: 60_000 }]);
  if (tooMany) return tooMany;
  const v = await portalView(params.token);
  if (v.state === "invalid") return errorResponse(404, "NOT_FOUND", "This link is not valid.");
  return json(v);
});
