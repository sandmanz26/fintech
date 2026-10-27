import { z } from "zod";
import { body, json, route } from "@/lib/api";
import { updateChecklistItem } from "@/lib/domain/underwriting/service";

const Schema = z.object({ status: z.enum(["PASS", "FAIL", "WAIVED", "PENDING"]), note: z.string().optional() });

/** PATCH /applications/:id/checklist/:key — PASS / FAIL / WAIVED (waived needs a note). */
export const PATCH = route<{ id: string; key: string }>({ cap: "underwriting.decide.standard" }, async (req, { params, user }) => {
  const input = await body(req, Schema);
  const c = await updateChecklistItem({ id: user.id, role: user.role }, params.id, params.key, input.status, input.note);
  return json(c);
});
