import { z } from "zod";
import { db } from "@/lib/db";
import { body, json, route, toActor } from "@/lib/api";
import { record } from "@/lib/domain/audit";
import { NotFoundError } from "@/lib/errors";

export const POST = route<{ id: string }>({ cap: "underwriting.decide.standard" }, async (req, { params, user }) => {
  const { status } = await body(req, z.object({ status: z.enum(["ACCEPTED", "REJECTED"]) }));
  await db.$transaction(async (tx) => {
    const d = await tx.document.findUnique({ where: { id: params.id } });
    if (!d) throw new NotFoundError("Document");
    await tx.document.update({ where: { id: d.id }, data: { status } });
    await record(tx, toActor(user), { action: "DOCUMENT_REVIEWED", entityType: "Document", entityId: d.id, before: { status: d.status }, after: { status, merchantId: d.merchantId, type: d.type } });
  });
  return json({ ok: true });
});
