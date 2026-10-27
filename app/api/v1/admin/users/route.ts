import { db } from "@/lib/db";
import { json, route, toActor } from "@/lib/api";
import { createUser } from "@/lib/domain/admin/service";

export const GET = route({ cap: "users.manage" }, async () => json({ items: await db.user.findMany({ orderBy: { createdAt: "asc" } }) }));

export const POST = route({ cap: "users.manage" }, async (req, { user }) => json(await createUser(toActor(user), await req.json().catch(() => ({}))), { status: 201 }));
