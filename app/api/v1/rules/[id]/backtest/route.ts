import { z } from "zod";
import { db } from "@/lib/db";
import { body, json, route } from "@/lib/api";
import { backtestRule } from "@/lib/domain/rules/service";
import { RuleDefinitionSchema } from "@/lib/domain/rules/dsl";

const Schema = z.object({ definition: z.unknown(), days: z.number().int().min(7).max(120).default(90) });

/**
 * POST /rules/:id/backtest — evaluates the candidate definition (and the active version, for the
 * diff) against stored daily metrics. Deterministic; writes nothing. :id may be "new".
 */
export const POST = route<{ id: string }>({ cap: "rules.write" }, async (req, { params }) => {
  const input = await body(req, Schema);
  const candidate = RuleDefinitionSchema.parse(input.definition);
  let active = null;
  if (params.id !== "new") {
    const rule = await db.rule.findUnique({ where: { id: params.id }, include: { versions: true } });
    const v = rule?.versions.find((x) => x.id === rule.activeVersionId);
    if (v) active = RuleDefinitionSchema.parse(v.definition);
  }
  return json(await backtestRule(candidate, active, input.days));
});
