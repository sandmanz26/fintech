import { z } from "zod";
import { body, json, route, toActor } from "@/lib/api";
import { transitionCase } from "@/lib/domain/cases/service";

const Schema = z.object({
  to: z.enum(["NEW", "ASSIGNED", "IN_REVIEW", "AWAITING_MERCHANT", "PENDING_APPROVAL", "RESOLVED", "REOPENED"]),
  reasonCode: z.string().optional(),
  note: z.string().optional(),
});

/** POST /cases/:id/transition — validated against the case state machine; RESOLVED needs code + note. */
export const POST = route<{ id: string }>({ cap: "case.work" }, async (req, { params, user }) => {
  const input = await body(req, Schema);
  await transitionCase(params.id, input.to, toActor(user), { reasonCode: input.reasonCode, note: input.note });
  return json({ ok: true });
});
