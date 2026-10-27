import { z } from "zod";
import { db } from "@/lib/db";
import { body, json, route, toActor } from "@/lib/api";
import { linkAlert, openCaseForMerchant } from "@/lib/domain/cases/service";
import { NotFoundError, ConflictError } from "@/lib/errors";

const Schema = z.union([z.object({ caseId: z.string().min(1) }), z.object({ newCase: z.literal(true) })]);

/** POST /alerts/:id/link — { caseId } links to an existing case; { newCase: true } opens one for it. */
export const POST = route<{ id: string }>({ cap: "case.work" }, async (req, { params, user }) => {
  const input = await body(req, Schema);
  const caseId = await db.$transaction(async (tx) => {
    const a = await tx.alert.findUnique({ where: { id: params.id }, include: { merchant: { select: { dbaName: true, legalName: true } } } });
    if (!a) throw new NotFoundError("Alert");
    if (a.status !== "OPEN") throw new ConflictError("This alert is already handled.");
    let id: string;
    if ("caseId" in input) id = input.caseId;
    else {
      const rule = await tx.rule.findUnique({ where: { key: a.ruleKey } });
      const c = await openCaseForMerchant(tx, { merchantId: a.merchantId, type: "MONITORING", priority: a.severity, title: rule?.name ?? a.ruleKey, actor: toActor(user), assigneeId: user.id, payload: { alertId: a.id } });
      id = c.id;
    }
    await linkAlert(tx, a.id, id, toActor(user));
    return id;
  });
  return json({ caseId });
});
