import type { RuleDefinition } from "./dsl";

type Seed = { key: string; name: string; description: string; definition: RuleDefinition };

const monitored = { merchantStatus: ["ACTIVE", "UNDER_REVIEW", "RESTRICTED"], minAgeDays: 14 };
const dedupe = { windowHours: 24, keyTemplate: "{ruleKey}:{merchantId}:{date}" };

/** The nine default monitoring rules (PRD §6.3). Money in minor units, ratios as fractions. */
export const DEFAULT_RULES: Seed[] = [
  {
    key: "R-VOL-SPIKE",
    name: "Volume spike",
    description: "Today's settled volume is more than 3x the 30-day daily average and above an absolute floor.",
    definition: {
      key: "R-VOL-SPIKE",
      scope: "merchant_daily",
      when: {
        all: [
          { metric: "gross_volume_1d", op: ">", value: { mul: [3, { metric: "avg_gross_volume_30d" }] } },
          { metric: "gross_volume_1d", op: ">", value: 500000 },
        ],
      },
      filters: monitored,
      severity: "HIGH",
      dedupe,
      autoCase: { enabled: true, caseType: "MONITORING", priority: "HIGH", slaHours: 24 },
      evidenceMetrics: ["gross_volume_1d", "avg_gross_volume_30d", "avg_ticket_7d"],
    },
  },
  {
    key: "R-VOL-OVER-PROFILE",
    name: "Volume above declared profile",
    description: "30-day volume is more than 150% of the monthly volume the merchant declared.",
    definition: {
      key: "R-VOL-OVER-PROFILE",
      scope: "merchant_daily",
      when: { metric: "volume_vs_expected_monthly", op: ">", value: 1.5 },
      filters: monitored,
      severity: "MEDIUM",
      dedupe: { windowHours: 168, keyTemplate: "{ruleKey}:{merchantId}:{date}" },
      autoCase: { enabled: true, caseType: "MONITORING", priority: "MEDIUM", slaHours: 72 },
      evidenceMetrics: ["gross_volume_30d", "expected_monthly_volume"],
    },
  },
  {
    key: "R-CB-RATIO",
    name: "High chargeback ratio",
    description: "30-day chargeback ratio at or above 0.75% with at least 10 chargebacks.",
    definition: {
      key: "R-CB-RATIO",
      scope: "merchant_daily",
      when: {
        all: [
          { metric: "cb_ratio_30d", op: ">=", value: 0.0075 },
          { metric: "chargeback_count_30d", op: ">=", value: 10 },
        ],
      },
      filters: monitored,
      severity: "HIGH",
      dedupe,
      autoCase: { enabled: true, caseType: "DISPUTE_SPIKE", priority: "HIGH", slaHours: 24 },
      evidenceMetrics: ["cb_ratio_30d", "chargeback_count_30d", "settled_count_30d"],
    },
  },
  {
    key: "R-CB-NETWORK-PROX",
    name: "Near the network threshold",
    description: "30-day chargeback ratio at or above 80% of the network threshold configured in policy.",
    definition: {
      key: "R-CB-NETWORK-PROX",
      scope: "merchant_daily",
      when: { metric: "cb_ratio_30d", op: ">=", value: { mul: [0.8, { metric: "network_cb_threshold" }] } },
      filters: monitored,
      severity: "CRITICAL",
      dedupe,
      autoCase: { enabled: true, caseType: "DISPUTE_SPIKE", priority: "CRITICAL", slaHours: 4 },
      evidenceMetrics: ["cb_ratio_30d", "network_cb_threshold", "chargeback_count_30d"],
    },
  },
  {
    key: "R-REFUND-RATIO",
    name: "High refund ratio",
    description: "30-day refunds above 10% of settled transactions.",
    definition: {
      key: "R-REFUND-RATIO",
      scope: "merchant_daily",
      when: { metric: "refund_ratio_30d", op: ">", value: 0.1 },
      filters: monitored,
      severity: "MEDIUM",
      dedupe,
      autoCase: { enabled: false, caseType: "MONITORING" },
      evidenceMetrics: ["refund_ratio_30d", "settled_count_30d"],
    },
  },
  {
    key: "R-CARD-TESTING",
    name: "Card testing",
    description: "More than 50 very small authorisations today with a decline rate above 40%.",
    definition: {
      key: "R-CARD-TESTING",
      scope: "merchant_daily",
      when: {
        all: [
          { metric: "small_auth_count_1d", op: ">", value: 50 },
          { metric: "decline_rate_1d", op: ">", value: 0.4 },
        ],
      },
      filters: { merchantStatus: ["ACTIVE", "UNDER_REVIEW", "RESTRICTED"], minAgeDays: 0 },
      severity: "CRITICAL",
      dedupe,
      autoCase: { enabled: true, caseType: "MONITORING", priority: "CRITICAL", slaHours: 4 },
      evidenceMetrics: ["small_auth_count_1d", "decline_rate_1d", "auth_attempts_1d"],
    },
  },
  {
    key: "R-TICKET-SHIFT",
    name: "Average ticket shift",
    description: "7-day average ticket more than twice the declared average ticket.",
    definition: {
      key: "R-TICKET-SHIFT",
      scope: "merchant_daily",
      when: { metric: "avg_ticket_7d", op: ">", value: { mul: [2, { metric: "expected_avg_ticket" }] } },
      filters: monitored,
      severity: "MEDIUM",
      dedupe,
      autoCase: { enabled: true, caseType: "MONITORING", priority: "MEDIUM", slaHours: 72 },
      evidenceMetrics: ["avg_ticket_7d", "expected_avg_ticket"],
    },
  },
  {
    key: "R-XBORDER",
    name: "Unexpected cross-border volume",
    description: "More than half of the last 7 days' transactions are cross-border for a domestic merchant.",
    definition: {
      key: "R-XBORDER",
      scope: "merchant_daily",
      when: {
        all: [
          { metric: "cross_border_pct_7d", op: ">", value: 0.5 },
          { metric: "is_domestic", op: "==", value: 1 },
        ],
      },
      filters: monitored,
      severity: "MEDIUM",
      dedupe,
      autoCase: { enabled: false, caseType: "MONITORING" },
      evidenceMetrics: ["cross_border_pct_7d"],
    },
  },
  {
    key: "R-DORMANT-AFTER-SPIKE",
    name: "Quiet after a spike",
    description: "No transactions for 5 days or more after a volume spike in the last 14 days (bust-out pattern).",
    definition: {
      key: "R-DORMANT-AFTER-SPIKE",
      scope: "merchant_daily",
      when: {
        all: [
          { metric: "days_since_last_txn", op: ">=", value: 5 },
          { metric: "vol_spike_alerts_14d", op: ">=", value: 1 },
        ],
      },
      filters: monitored,
      severity: "HIGH",
      dedupe,
      autoCase: { enabled: true, caseType: "MONITORING", priority: "HIGH", slaHours: 24 },
      evidenceMetrics: ["days_since_last_txn", "vol_spike_alerts_14d"],
    },
  },
];
