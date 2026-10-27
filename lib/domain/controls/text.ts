import { formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/format";

/** Plain-language descriptions of a control: one for staff, one for the merchant. */

export const CONTROL_LABEL: Record<string, string> = {
  VOLUME_LIMIT_DAILY: "Daily volume limit",
  VOLUME_LIMIT_MONTHLY: "Monthly volume limit",
  MAX_TICKET: "Maximum transaction",
  ROLLING_RESERVE: "Rolling reserve",
  FIXED_RESERVE: "Fixed reserve",
  UPFRONT_RESERVE: "Upfront reserve",
  PAYOUT_DELAY: "Payout delay",
  PAYOUT_HOLD: "Payout hold",
};

export function controlSummary(type: string, p: Record<string, unknown>, currency = "USD"): string {
  const m = (v: unknown) => formatMoney(String(v ?? "0"), currency);
  switch (type) {
    case "VOLUME_LIMIT_DAILY":
      return `${m(p.limitMinor)} a day`;
    case "VOLUME_LIMIT_MONTHLY":
      return `${m(p.limitMinor)} a month`;
    case "MAX_TICKET":
      return `${m(p.maxMinor)} per transaction`;
    case "ROLLING_RESERVE":
      return `${Number(p.pctBps) / 100}% for ${p.holdDays} days${p.capMinor ? `, capped at ${m(p.capMinor)}` : ""}`;
    case "FIXED_RESERVE":
      return `${m(p.targetMinor)} target, ${Number(p.pctUntilTargetBps) / 100}% of sales until reached`;
    case "UPFRONT_RESERVE":
      return `${m(p.amountMinor)} once`;
    case "PAYOUT_DELAY":
      return `Paid T+${p.days} instead of T+1`;
    case "PAYOUT_HOLD":
      return p.untilDate ? `No payouts until ${fmtDate(String(p.untilDate))}` : "No payouts until lifted";
    default:
      return "";
  }
}

/** What the merchant will read. No scores, rule names or internal notes (PRD §6.4). */
export function merchantFacingControlText(type: string, p: Record<string, unknown>, reasonText: string, currency = "USD", reviewAt?: Date | string | null): string {
  const m = (v: unknown) => formatMoney(String(v ?? "0"), currency);
  const review = reviewAt ? ` We will review this by ${fmtDate(reviewAt)}.` : "";
  const why = reasonText ? ` ${reasonText.trim().replace(/\.?$/, ".")}` : "";
  switch (type) {
    case "ROLLING_RESERVE":
      return `From your next payout we will hold ${Number(p.pctBps) / 100}% of each day's card sales and return each amount ${p.holdDays} days later.${p.capMinor ? ` We will never hold more than ${m(p.capMinor)} in total.` : ""}${why}${review}`;
    case "FIXED_RESERVE":
      return `We will hold ${Number(p.pctUntilTargetBps) / 100}% of your daily card sales until ${m(p.targetMinor)} is set aside as a reserve. After that your payouts return to normal.${why}${review}`;
    case "UPFRONT_RESERVE":
      return `We will set aside ${m(p.amountMinor)} from your first payouts as a reserve.${why}${review}`;
    case "PAYOUT_DELAY":
      return `Your payouts will arrive ${p.days} days after each sale instead of the next business day.${why}${review}`;
    case "PAYOUT_HOLD":
      return `We have paused payouts to your bank account${p.untilDate ? ` until ${fmtDate(String(p.untilDate))}` : " while we complete a review"}. Your sales are still recorded and the money is safe.${why}${review}`;
    case "VOLUME_LIMIT_DAILY":
      return `For now your account can accept up to ${m(p.limitMinor)} in card sales a day.${why}${review}`;
    case "VOLUME_LIMIT_MONTHLY":
      return `For now your account can accept up to ${m(p.limitMinor)} in card sales a month.${why}${review}`;
    case "MAX_TICKET":
      return `For now a single card payment can be up to ${m(p.maxMinor)}.${why}${review}`;
    default:
      return why.trim();
  }
}
