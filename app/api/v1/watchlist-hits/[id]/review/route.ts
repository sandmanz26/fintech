import { z } from "zod";
import { body, json, route } from "@/lib/api";
import { reviewWatchlistHit } from "@/lib/domain/underwriting/service";

const Schema = z.object({ status: z.enum(["FALSE_POSITIVE", "CONFIRMED"]), note: z.string().trim().min(3) });

export const POST = route<{ id: string }>({ cap: "case.work" }, async (req, { params, user }) => {
  const input = await body(req, Schema);
  await reviewWatchlistHit({ id: user.id, role: user.role }, params.id, input.status, input.note);
  return json({ ok: true });
});
