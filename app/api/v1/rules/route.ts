import { z } from "zod";
import { db } from "@/lib/db";
import { body, json, route, toActor } from "@/lib/api";
import { createRuleVersion, ruleStats } from "@/lib/domain/rules/service";

/** GET /rules — rules with their active version and performance. */
export const GET = route({ cap: "rules.read" }, async () => {
  const [rules, stats] = await Promise.all([db.rule.findMany({ include: { versions: { orderBy: { version: "desc" } } }, orderBy: { key: "asc" } }), ruleStats()]);
  return json({ items: rules.map((r) => ({ ...r, stats: stats.get(r.key) ?? null })) });
});

const CreateSchema = z.object({ name: z.string().trim().min(3), description: z.string().trim().min(3), definition: z.unknown(), changeNote: z.string().trim().min(3, "A change note is required"), activate: z.boolean().default(true) });

/** POST /rules — a new rule with its first version. */
export const POST = route({ cap: "rules.write" }, async (req, { user }) => {
  const input = await body(req, CreateSchema);
  const r = await createRuleVersion(toActor(user), { ...input, definition: input.definition });
  return json(r, { status: 201 });
});
