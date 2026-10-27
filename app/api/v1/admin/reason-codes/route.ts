import { db } from "@/lib/db";
import { json, route, toActor } from "@/lib/api";
import { upsertReasonCode } from "@/lib/domain/admin/service";

export const GET = route({ cap: "reasoncodes.write" }, async () => json({ items: await db.reasonCode.findMany({ orderBy: [{ category: "asc" }, { code: "asc" }] }) }));

/** POST — create or update a reason code (codes are never deleted; deactivate instead). */
export const POST = route({ cap: "reasoncodes.write" }, async (req, { user }) => json(await upsertReasonCode(toActor(user), await req.json().catch(() => ({})))));
