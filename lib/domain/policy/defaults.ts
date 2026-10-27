import type { PolicyParams } from "./types";

/** Policy v1, seeded. Values follow PRD §6.2, §6.4 and §6.5. */
export const DEFAULT_POLICY: PolicyParams = {
  scoring: {
    mccTiers: {
      elevated: ["5732", "5968", "5815", "7011", "4121", "5945"],
      high: ["4722", "5967", "6540", "5499", "4829"],
      prohibited: ["7995", "7273", "5962"],
    },
    mccNames: {
      "4121": "Taxis and rideshare",
      "4722": "Travel agencies",
      "4829": "Money transfer",
      "5411": "Grocery stores",
      "5499": "Supplements and specialty food",
      "5651": "Family clothing",
      "5691": "Clothing stores",
      "5732": "Electronics stores",
      "5734": "Software stores",
      "5812": "Restaurants",
      "5815": "Digital goods",
      "5945": "Toy and game shops",
      "5962": "Direct marketing, travel",
      "5967": "Direct marketing, inbound",
      "5968": "Subscription merchants",
      "5977": "Cosmetics stores",
      "5992": "Florists",
      "5999": "Miscellaneous retail",
      "6540": "Stored value and gift cards",
      "7011": "Hotels and lodging",
      "7230": "Beauty and barber shops",
      "7273": "Dating and escort services",
      "7298": "Health and beauty spas",
      "7372": "Software and IT services",
      "7995": "Betting and gambling",
      "8299": "Schools and education",
      "8999": "Professional services",
    },
    primaryCountries: ["US"],
    ticketP90ByMcc: {
      "4722": "150000",
      "5732": "60000",
      "5968": "8000",
      "6540": "20000",
      "5499": "12000",
      "5812": "9000",
      "5411": "15000",
      "7011": "80000",
    },
    defaultTicketP90Minor: "25000",
    volumeVsAge: { maxAgeMonths: 12, monthlyVolumeThresholdMinor: "10000000" }, // $100,000
    points: {
      mcc: { standard: 0, elevated: 10, high: 20 },
      businessAge: { under6m: 12, from6to24m: 6, over24m: 0 },
      deliveryModel: { IMMEDIATE: 0, DIGITAL: 3, SHIPPED: 6, SUBSCRIPTION: 8, FUTURE_SERVICE: 12 },
      deliveryDays: { upTo7: 0, from8to30: 5, over30: 10 },
      ticketAboveP90: 8,
      volumeVsAge: 10,
      crossBorder: 6,
      priorCb: { highBps: 90, high: 12, midBps: 50, mid: 6 },
      websiteGapEach: 2,
      websiteGapMax: 6,
      screeningPotential: 4,
    },
    bands: { mediumFrom: 30, highFrom: 55 },
  },
  fourEyes: {
    rollingReservePctBps: 1000,
    fixedReserveMinor: "5000000", // $50,000
    payoutHold: true,
    removeReserve: true,
  },
  sla: { CRITICAL: 4, HIGH: 24, MEDIUM: 72, LOW_BUSINESS_DAYS: 5 },
  network: {
    // Published summaries of card-network monitoring programs disagree and change often
    // (see ROAST.md §1). These follow the April 2026 summaries; verify before relying on them.
    label: "Verify against current network rules",
    visa: { merchantExcessiveBps: 150, merchantMinCount: 1500, acquirerAboveStandardBps: 50, acquirerExcessiveBps: 70, countFraudDisputesTwice: true },
    mastercard: { ecmBps: 150, ecmMinChargebacks: 100 },
    earlyWarningShare: 0.8,
    warningMinCount: 10,
  },
  disputeWindowDays: 120,
  rescoreMonths: { LOW: 12, MEDIUM: 3, HIGH: 1 },
  smallAuthThresholdMinor: "200", // $2.00
  rfiTokenGraceDays: 7,
};
