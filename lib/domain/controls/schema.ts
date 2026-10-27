import { z } from "zod";

const minor = z.string().regex(/^\d+$/, "Enter an amount");
const positiveMinor = minor.refine((v) => BigInt(v) > 0n, "Must be more than zero");

/** Params per control type (PRD §6.5). Money as minor-unit strings; percentages in basis points. */
export const ControlParamsSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("VOLUME_LIMIT_DAILY"), params: z.object({ limitMinor: positiveMinor }) }),
  z.object({ type: z.literal("VOLUME_LIMIT_MONTHLY"), params: z.object({ limitMinor: positiveMinor }) }),
  z.object({ type: z.literal("MAX_TICKET"), params: z.object({ maxMinor: positiveMinor }) }),
  z.object({
    type: z.literal("ROLLING_RESERVE"),
    params: z.object({
      pctBps: z.number().int().min(1).max(10_000),
      holdDays: z.number().int().min(1).max(365),
      capMinor: positiveMinor.optional(),
    }),
  }),
  z.object({
    type: z.literal("FIXED_RESERVE"),
    params: z.object({ targetMinor: positiveMinor, pctUntilTargetBps: z.number().int().min(1).max(10_000) }),
  }),
  z.object({ type: z.literal("UPFRONT_RESERVE"), params: z.object({ amountMinor: positiveMinor }) }),
  z.object({ type: z.literal("PAYOUT_DELAY"), params: z.object({ days: z.number().int().min(2).max(60) }) }),
  z.object({ type: z.literal("PAYOUT_HOLD"), params: z.object({ untilDate: z.string().date().optional() }) }),
]);

export type ControlInput = z.infer<typeof ControlParamsSchema>;

export const CreateControlSchema = z.intersection(
  ControlParamsSchema,
  z.object({
    merchantId: z.string().min(1),
    reasonCode: z.string().min(1, "Choose a reason"),
    note: z.string().trim().min(3, "Explain why in a sentence"),
    reviewAt: z.string().date(),
    effectiveFrom: z.string().date().optional(),
    caseId: z.string().optional(),
  }),
);

export const RESERVE_TYPES = ["ROLLING_RESERVE", "FIXED_RESERVE", "UPFRONT_RESERVE"] as const;
export const HEAVY_TYPES = [...RESERVE_TYPES, "PAYOUT_HOLD"] as const;
export const LIMIT_TYPES = ["VOLUME_LIMIT_DAILY", "VOLUME_LIMIT_MONTHLY", "MAX_TICKET", "PAYOUT_DELAY"] as const;
