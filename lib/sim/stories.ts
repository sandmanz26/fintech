/**
 * The five demo stories (PRD §11). Patterns are expressed relative to STORY_ANCHOR, the last
 * day the seed simulates (the day before the demo's "today").
 */

export const SIM_TODAY = "2026-10-27";
export const STORY_ANCHOR = "2026-10-26";

export const STORY = {
  LUMEN: "US-LTC-61530",
  BRIGHTSIDE: "US-BRS-48211",
  QUICKTOP: "US-QTG-30927",
  GLOW: "US-GSB-77104",
  NIMBUS: "US-NSP-55819",
} as const;

export type DayPattern = {
  countMultiplier: number;
  ticketMultiplier: number;
  /** Extra tiny authorisations (card testing) and their decline rate. */
  smallAuths?: { count: number; declineRate: number };
  /** Received-chargeback ratio for the day, for stories that script disputes by receipt date. */
  receivedCbRatio?: number;
};

/** k = days from the anchor (0 = anchor, -1 = the day before, +1 = first demo day). */
export function storyPattern(registrationNo: string, k: number): DayPattern | null {
  switch (registrationNo) {
    case STORY.BRIGHTSIDE:
      // Volume up ~5x for three days: 1.67x the orders at 3x the ticket.
      if (k >= -2 && k <= 0) return { countMultiplier: 1.67, ticketMultiplier: 3 };
      return { countMultiplier: 1, ticketMultiplier: 1 };
    case STORY.QUICKTOP:
      if (k === 0) return { countMultiplier: 1, ticketMultiplier: 1, smallAuths: { count: 620, declineRate: 0.72 } };
      return { countMultiplier: 1, ticketMultiplier: 1 };
    case STORY.GLOW: {
      // Chargebacks received climb from 0.35% to 1.55% of settled over 60 days.
      const r = k <= -60 ? 0.0035 : Math.min(0.0155, 0.0035 + (0.012 * (k + 60)) / 60);
      return { countMultiplier: 1, ticketMultiplier: 1, receivedCbRatio: k > 0 ? 0.0155 : r };
    }
    case STORY.NIMBUS:
      return { countMultiplier: 1, ticketMultiplier: 1, receivedCbRatio: 0.011 };
    default:
      return null;
  }
}
