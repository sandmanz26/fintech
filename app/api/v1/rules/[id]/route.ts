import { z } from "zod";
import { db } from "@/lib/db";
import { body, json, route, toActor } from "@/lib/api";
import { setRuleEnabled, activateRuleVersion } from "@/lib/domain/rules/service";
import { NotFoundError } from "@/lib/errors";

export const GET = route<{ id: string }>({ cap: "rules.read" }, async (_req, { params }) => {
  const r = await db.rule.findUnique({ where: { id: params.id }, include: { versions: { orderBy: { version: "desc" } } } });
  if (!r) throw new NotFoundError("Rule");
  return json(r);
});

const PatchSchema = z.object({ enabled: z.boolean().optional(), activeVersionId: z.string().optional() });

/** PATCH /rules/:id — enable/disable, or roll back to an earlier version. */
export const PATCH = route<{ id: string }>({ cap: "rules.write" }, async (req, { params, user }) => {
  const input = await body(req, PatchSchema);
  if (input.enabled !== undefined) await setRuleEnabled(toActor(user), params.id, input.enabled);
  if (input.activeVersionId) await activateRuleVersion(toActor(user), params.id, input.activeVersionId);
  return json({ ok: true });
});
