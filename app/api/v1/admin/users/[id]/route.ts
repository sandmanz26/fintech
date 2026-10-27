import { z } from "zod";
import { body, json, route, toActor } from "@/lib/api";
import { updateUser } from "@/lib/domain/admin/service";

const Schema = z.object({ role: z.enum(["ANALYST", "SENIOR_ANALYST", "RISK_MANAGER", "COMPLIANCE", "AUDITOR", "ADMIN", "MERCHANT"]).optional(), active: z.boolean().optional() });

export const PATCH = route<{ id: string }>({ cap: "users.manage" }, async (req, { params, user }) => json(await updateUser(toActor(user), params.id, await body(req, Schema))));
