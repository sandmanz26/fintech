import { json, route } from "@/lib/api";
import { createControl } from "@/lib/domain/controls/service";

/** POST /controls — ACTIVE at once below the four-eyes thresholds, otherwise PENDING_APPROVAL. */
export const POST = route({ cap: ["control.limit", "control.propose"] }, async (req, { user }) => {
  const r = await createControl({ id: user.id, role: user.role }, await req.json().catch(() => ({})));
  return json(r, { status: 201 });
});
