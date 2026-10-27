import { z } from "zod";
import { db } from "@/lib/db";
import { body, json, route, toActor } from "@/lib/api";
import { createPolicyVersion } from "@/lib/domain/policy";
import { PolicyParamsSchema } from "@/lib/domain/policy/types";
import { bandFor } from "@/lib/domain/scoring";

export const GET = route({ cap: ["policy.write", "users.manage"] }, async () => json({ items: await db.policy.findMany({ orderBy: { version: "desc" } }) }));

const Schema = z.object({ params: z.unknown(), changeNote: z.string().trim().min(3, "A change note is required"), dryRun: z.boolean().default(false) });

/**
 * POST /admin/policies — a new policy version (append-only). With dryRun, reports how many merchants'
 * bands the new thresholds would move at their current scores, without saving.
 */
export const POST = route({ cap: "policy.write" }, async (req, { user }) => {
  const input = await body(req, Schema);
  const params = PolicyParamsSchema.parse(input.params);
  if (input.dryRun) {
    const ms = await db.merchant.findMany({ where: { currentScore: { not: null }, currentBand: { not: "PROHIBITED" } }, select: { currentScore: true, currentBand: true } });
    const moves: Record<string, number> = {};
    for (const m of ms) {
      const nb = bandFor(m.currentScore!, params);
      if (nb !== m.currentBand) moves[`${m.currentBand}→${nb}`] = (moves[`${m.currentBand}→${nb}`] ?? 0) + 1;
    }
    return json({ moves, checked: ms.length });
  }
  const p = await createPolicyVersion(toActor(user), params, input.changeNote);
  return json(p, { status: 201 });
});
