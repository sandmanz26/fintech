import { z } from "zod";

const minorStr = z.string().regex(/^\d+$/, "Minor units as a whole-number string");

/**
 * Versioned policy parameters (PRD §6.9). Every threshold that a person might reasonably
 * change lives here, not in code. Money is a string of minor units so it survives JSON.
 */
export const PolicyParamsSchema = z.object({
  scoring: z.object({
    mccTiers: z.object({
      elevated: z.array(z.string()),
      high: z.array(z.string()),
      prohibited: z.array(z.string()),
    }),
    mccNames: z.record(z.string()),
    primaryCountries: z.array(z.string()),
    ticketP90ByMcc: z.record(minorStr),
    defaultTicketP90Minor: minorStr,
    volumeVsAge: z.object({ maxAgeMonths: z.number().int(), monthlyVolumeThresholdMinor: minorStr }),
    points: z.object({
      mcc: z.object({ standard: z.number(), elevated: z.number(), high: z.number() }),
      businessAge: z.object({ under6m: z.number(), from6to24m: z.number(), over24m: z.number() }),
      deliveryModel: z.object({
        IMMEDIATE: z.number(),
        DIGITAL: z.number(),
        SHIPPED: z.number(),
        SUBSCRIPTION: z.number(),
        FUTURE_SERVICE: z.number(),
      }),
      deliveryDays: z.object({ upTo7: z.number(), from8to30: z.number(), over30: z.number() }),
      ticketAboveP90: z.number(),
      volumeVsAge: z.number(),
      crossBorder: z.number(),
      priorCb: z.object({ highBps: z.number(), high: z.number(), midBps: z.number(), mid: z.number() }),
      websiteGapEach: z.number(),
      websiteGapMax: z.number(),
      screeningPotential: z.number(),
    }),
    bands: z.object({ mediumFrom: z.number().int(), highFrom: z.number().int() }),
  }),
  fourEyes: z.object({
    rollingReservePctBps: z.number().int(), // >= this needs approval (1000 = 10%)
    fixedReserveMinor: minorStr, // fixed/upfront reserve >= this needs approval
    payoutHold: z.boolean(),
    removeReserve: z.boolean(),
  }),
  sla: z.object({ CRITICAL: z.number(), HIGH: z.number(), MEDIUM: z.number(), LOW_BUSINESS_DAYS: z.number() }),
  network: z.object({
    label: z.string(),
    /** Visa Acquirer Monitoring Program: (fraud reports + disputes) / settled card-not-present, Visa only. */
    visa: z.object({
      merchantExcessiveBps: z.number().int(),
      merchantMinCount: z.number().int(),
      acquirerAboveStandardBps: z.number().int(),
      acquirerExcessiveBps: z.number().int(),
      countFraudDisputesTwice: z.boolean(), // a fraud dispute with a matching fraud report counts twice
    }),
    /** Mastercard Excessive Chargeback Merchant: chargebacks in a month / Mastercard sales the month before. */
    mastercard: z.object({ ecmBps: z.number().int(), ecmMinChargebacks: z.number().int() }),
    /** Early-warning line as a share of each program line, and the count below which nobody is paged. */
    earlyWarningShare: z.number().gt(0).lte(1),
    warningMinCount: z.number().int(),
  }),
  disputeWindowDays: z.number().int(),
  rescoreMonths: z.object({ LOW: z.number().int(), MEDIUM: z.number().int(), HIGH: z.number().int() }),
  smallAuthThresholdMinor: minorStr,
  rfiTokenGraceDays: z.number().int(),
});

export type PolicyParams = z.infer<typeof PolicyParamsSchema>;
