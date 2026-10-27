import { z } from "zod";
import { body, json, route } from "@/lib/api";
import { previewControl } from "@/lib/domain/controls/service";
import { ControlParamsSchema, RESERVE_TYPES } from "@/lib/domain/controls/schema";
import { can } from "@/lib/auth/rbac";

const Schema = z.intersection(
  ControlParamsSchema,
  z.object({ merchantId: z.string(), reasonCode: z.string().optional(), reviewAt: z.string().optional(), effectiveFrom: z.string().optional() }),
);

/** POST /controls/preview — 90-day impact simulation; saves nothing. */
export const POST = route({ cap: ["control.limit", "control.propose"] }, async (req, { user }) => {
  const input = await body(req, Schema);
  const p = await previewControl({ merchantId: input.merchantId, type: input.type, params: input.params as Record<string, unknown>, reasonCode: input.reasonCode, reviewAt: input.reviewAt, effectiveFrom: input.effectiveFrom });
  // An analyst's reserve goes to a second approver even under the threshold (DECISIONS.md).
  if (!p.needsApproval.required && (RESERVE_TYPES as readonly string[]).includes(input.type) && !can(user.role, "control.reserve.small")) {
    p.needsApproval = { required: true, reason: "Reserves set by an analyst need a senior approver" };
  }
  return json(p);
});
