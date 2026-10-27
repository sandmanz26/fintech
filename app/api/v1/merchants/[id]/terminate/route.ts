import { json, route } from "@/lib/api";
import { proposeTermination } from "@/lib/domain/offboarding/service";

/** POST /merchants/:id/terminate — creates a TERMINATE approval request (ANALYST+ may propose). */
export const POST = route<{ id: string }>({ cap: "control.propose" }, async (req, { params, user }) => {
  const r = await proposeTermination({ id: user.id, role: user.role }, params.id, await req.json().catch(() => ({})));
  return json(r, { status: 201 });
});
