import { db } from "@/lib/db";
import { json, route, toActor } from "@/lib/api";
import { record } from "@/lib/domain/audit";
import { NotFoundError } from "@/lib/errors";

/** POST — full owner PII for authorised roles; every view is written to the audit log (PRD §10). */
export const POST = route<{ id: string; ownerId: string }>({ cap: "owner.pii.read" }, async (_req, { params, user }) => {
  const o = await db.owner.findFirst({ where: { id: params.ownerId, merchantId: params.id } });
  if (!o) throw new NotFoundError("Owner");
  await db.$transaction((tx) => record(tx, toActor(user), { action: "OWNER_PII_VIEWED", entityType: "Owner", entityId: o.id, after: { merchantId: params.id, fields: ["dateOfBirth", "idNumber"] } }));
  return json({ dateOfBirth: o.dateOfBirth, idNumber: o.idNumber });
});
