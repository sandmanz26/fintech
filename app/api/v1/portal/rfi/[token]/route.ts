import { json, publicRoute, errorResponse } from "@/lib/api";
import { portalView } from "@/lib/domain/portal";

/** GET /portal/rfi/:token — public, token-gated; only merchant-safe fields. */
export const GET = publicRoute<{ token: string }>(async (_req, { params }) => {
  const v = await portalView(params.token);
  if (v.state === "invalid") return errorResponse(404, "NOT_FOUND", "This link is not valid.");
  return json(v);
});
