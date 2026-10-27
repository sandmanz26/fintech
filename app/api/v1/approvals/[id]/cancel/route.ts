import { json, route } from "@/lib/api";
import { cancelApproval } from "@/lib/domain/approvals/service";

/** POST /approvals/:id/cancel — only the requester, only while pending. */
export const POST = route<{ id: string }>({ cap: "control.propose" }, async (_req, { params, user }) => {
  await cancelApproval(params.id, { id: user.id, role: user.role });
  return json({ ok: true });
});
