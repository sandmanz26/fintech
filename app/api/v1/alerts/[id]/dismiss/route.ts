import { z } from "zod";
import { body, json, route, toActor } from "@/lib/api";
import { dismissAlert } from "@/lib/domain/cases/service";

const Schema = z.object({ reasonCode: z.string().min(1), note: z.string().trim().min(3) });

/** POST /alerts/:id/dismiss — reason code (ALERT_DISMISS) required; counts against rule precision. */
export const POST = route<{ id: string }>({ cap: "case.work" }, async (req, { params, user }) => {
  const input = await body(req, Schema);
  await dismissAlert(params.id, input.reasonCode, input.note, toActor(user));
  return json({ ok: true });
});
