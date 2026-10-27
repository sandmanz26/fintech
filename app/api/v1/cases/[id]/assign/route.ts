import { z } from "zod";
import { body, json, route, toActor } from "@/lib/api";
import { assignCase } from "@/lib/domain/cases/service";

export const POST = route<{ id: string }>({ cap: "case.work" }, async (req, { params, user }) => {
  const { assigneeId } = await body(req, z.object({ assigneeId: z.string().min(1) }));
  await assignCase(params.id, assigneeId, toActor(user));
  return json({ ok: true });
});
