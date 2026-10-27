/**
 * PRD §6.6 termination categories, with whether each puts the business and its principals on the
 * terminated merchant list. Card-network rules oblige listing for fraud, excessive chargebacks,
 * laundering and rule violations, and listing a merchant who simply left is a liability
 * (ROAST.md §2.2), so the category decides; nobody ticks a box. Shared by the service and the dialog.
 */
export const TERMINATION_CATEGORIES = {
  FRAUD: { label: "Fraud", listed: true },
  EXCESSIVE_CHARGEBACKS: { label: "Excessive chargebacks", listed: true },
  PRODUCT_POLICY: { label: "Product policy violation", listed: true },
  COMPLIANCE: { label: "Compliance or sanctions", listed: true },
  MERCHANT_REQUEST: { label: "Merchant request", listed: false },
  INACTIVE: { label: "Inactive", listed: false },
} as const;

export type TerminationCategory = keyof typeof TERMINATION_CATEGORIES;
export const listedFor = (c: TerminationCategory) => TERMINATION_CATEGORIES[c].listed;
