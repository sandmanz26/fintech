import { z } from "zod";
import { db } from "@/lib/db";
import { body, json, route, toActor } from "@/lib/api";
import { createRuleVersion } from "@/lib/domain/rules/service";
import { NotFoundError } from "@/lib/errors";

export const GET = route<{ id: string }>({ cap: "rules.read" }, async (_req, { params }) => {
  return json({ items: await db.ruleVersion.findMany({ where: { ruleId: params.id }, orderBy: { version: "desc" } }) });
});

const Schema = z.object({ name: z.string().trim().min(3).optional(), description: z.string().trim().optional(), definition: z.unknown(), changeNote: z.string().trim().min(3, "A change note is required"), activate: z.boolean().default(true) });

/** POST /rules/:id/versions — every save is a new version with a mandatory change note. */
export const POST = route<{ id: string }>({ cap: "rules.write" }, async (req, { params, user }) => {
  const input = await body(req, Schema);
  const rule = await db.rule.findUnique({ where: { id: params.id } });
  if (!rule) throw new NotFoundError("Rule");
  const r = await createRuleVersion(toActor(user), { ruleId: rule.id, name: input.name ?? rule.name, description: input.description ?? rule.description, definition: input.definition, changeNote: input.changeNote, activate: input.activate });
  return json(r, { status: 201 });
});
