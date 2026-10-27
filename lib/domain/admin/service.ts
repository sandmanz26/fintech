import type { Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { record, type Actor } from "@/lib/domain/audit";
import { ConflictError, NotFoundError } from "@/lib/errors";

export const UserSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(2),
  role: z.enum(["ANALYST", "SENIOR_ANALYST", "RISK_MANAGER", "COMPLIANCE", "AUDITOR", "ADMIN", "MERCHANT"]),
  merchantId: z.string().optional().nullable(),
});

export async function createUser(actor: Actor, raw: unknown) {
  const input = UserSchema.parse(raw);
  return db.$transaction(async (tx) => {
    if (await tx.user.findUnique({ where: { email: input.email } })) throw new ConflictError("A user with that email already exists.");
    const u = await tx.user.create({ data: { ...input, merchantId: input.merchantId ?? null } });
    await record(tx, actor, { action: "USER_CREATED", entityType: "User", entityId: u.id, after: { email: u.email, role: u.role } });
    return u;
  });
}

export async function updateUser(actor: Actor, id: string, patch: { role?: Role; active?: boolean }) {
  return db.$transaction(async (tx) => {
    const u = await tx.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundError("User");
    if (id === actor.id && (patch.active === false || (patch.role && patch.role !== u.role))) throw new ConflictError("You cannot change your own role or deactivate yourself.");
    const next = await tx.user.update({ where: { id }, data: patch });
    await record(tx, actor, { action: "USER_UPDATED", entityType: "User", entityId: id, before: { role: u.role, active: u.active }, after: { role: next.role, active: next.active } });
    return next;
  });
}

export const ReasonCodeSchema = z.object({
  code: z.string().regex(/^[A-Z]{2}-[A-Z0-9-]+$/, "Codes look like CT-CHARGEBACKS"),
  category: z.enum(["UNDERWRITING", "CONTROL", "ALERT_DISMISS", "CASE_RESOLUTION", "TERMINATION"]),
  label: z.string().trim().min(3),
  merchantFacingText: z.string().trim(),
  active: z.boolean().default(true),
});

export async function upsertReasonCode(actor: Actor, raw: unknown) {
  const input = ReasonCodeSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const before = await tx.reasonCode.findUnique({ where: { code: input.code } });
    const rc = await tx.reasonCode.upsert({ where: { code: input.code }, create: input, update: { label: input.label, merchantFacingText: input.merchantFacingText, active: input.active } });
    await record(tx, actor, { action: before ? "REASON_CODE_UPDATED" : "REASON_CODE_CREATED", entityType: "ReasonCode", entityId: rc.code, before, after: rc });
    return rc;
  });
}
