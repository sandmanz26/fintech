import { z } from "zod";
import { body, json, route, toActor } from "@/lib/api";
import { sendRfi } from "@/lib/domain/cases/service";

const Schema = z.object({
  items: z.array(z.object({ key: z.string(), label: z.string().min(2), docType: z.string(), required: z.boolean() })).min(1),
  message: z.string().trim().min(10),
  dueAt: z.string().date(),
});

/** POST /cases/:id/rfi — returns the portal token (shown once to the analyst, emailed to the merchant). */
export const POST = route<{ id: string }>({ cap: "case.work" }, async (req, { params, user }) => {
  const input = await body(req, Schema);
  const rfi = await sendRfi(params.id, { items: input.items, message: input.message, dueAt: new Date(`${input.dueAt}T23:59:59Z`) }, toActor(user));
  const base = process.env.APP_URL ?? new URL(req.url).origin;
  return json({ rfiId: rfi.id, token: rfi.token, portalUrl: `${base}/portal/rfi/${rfi.token}` }, { status: 201 });
});
