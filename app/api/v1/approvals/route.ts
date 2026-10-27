import { db } from "@/lib/db";
import { json, route } from "@/lib/api";
import { pendingApprovalsFor } from "@/lib/queries/queues";

/** GET /approvals?status=PENDING — for approvers, the requests they may decide; ?mine=1 for one's own. */
export const GET = route({ cap: ["approval.decide", "approval.decide.termination_compliance", "control.propose"] }, async (req, { user }) => {
  const sp = req.nextUrl.searchParams;
  if (sp.get("mine")) return json({ items: await db.approvalRequest.findMany({ where: { requestedById: user.id }, orderBy: { createdAt: "desc" }, take: 100 }) });
  if ((sp.get("status") ?? "PENDING") === "PENDING") return json({ items: await pendingApprovalsFor(user) });
  return json({ items: await db.approvalRequest.findMany({ where: { status: sp.get("status") as never }, orderBy: { decidedAt: "desc" }, take: 100 }) });
});
