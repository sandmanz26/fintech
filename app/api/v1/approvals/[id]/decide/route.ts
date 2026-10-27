import { z } from "zod";
import { body, json, route } from "@/lib/api";
import { decideApproval } from "@/lib/domain/approvals/service";

const Schema = z.object({ decision: z.enum(["APPROVE", "REJECT"]), note: z.string().trim().min(3) });

/**
 * POST /approvals/:id/decide — the server checks decider ≠ requester and the role; approving runs
 * the action in the same transaction as the status change.
 */
export const POST = route<{ id: string }>({ cap: ["approval.decide", "approval.decide.termination_compliance"] }, async (req, { params, user }) => {
  const input = await body(req, Schema);
  return json(await decideApproval(params.id, input.decision, input.note, { id: user.id, role: user.role }));
});
