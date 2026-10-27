import { z } from "zod";
import { json, route } from "@/lib/api";
import { requestRemoveControl } from "@/lib/domain/controls/service";

const Schema = z.object({ reasonCode: z.string().min(1), note: z.string().trim().min(3) });

/** DELETE /controls/:id — limits come off directly; reserves and payout holds need four-eyes. */
export const DELETE = route<{ id: string }>({ cap: ["control.limit", "control.propose"] }, async (req, { params, user }) => {
  const input = Schema.parse(await req.json().catch(() => ({})));
  const r = await requestRemoveControl({ id: user.id, role: user.role }, params.id, input.reasonCode, input.note);
  return json(r);
});
