import { z } from "zod";
import { body, json, route, toActor } from "@/lib/api";
import { addNote } from "@/lib/domain/cases/service";

export const POST = route<{ id: string }>({ cap: "case.work" }, async (req, { params, user }) => {
  const { body: text } = await body(req, z.object({ body: z.string().trim().min(1).max(5000) }));
  await addNote(params.id, text, toActor(user));
  return json({ ok: true }, { status: 201 });
});
