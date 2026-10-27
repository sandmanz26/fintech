# Sentinel: the roast

A candid review of what was built, written as if a head of risk at a payment facilitator, a
card-network compliance lead and a staff engineer had each spent an afternoon with it. The
research behind each point is linked. Fixes made after the review are listed per finding and in
the change log at the end; nothing here was softened after the fact.

**Verdict.** The workflow skeleton is good: queue, case, control, four-eyes, audit. It is what a risk
team does every day, and the explainable score and the reserve preview are better than most
in-house tools. But the numbers the head of risk will be judged on are wrong. Sentinel watches a
blended "chargeback ratio" that no card network calculates, so the screen that should keep the
payfac off a monitoring program doesn't. Compliance has two holes that would come up in a sponsor
bank audit: the terminated list is written but never read for people, and nobody is screened
again after onboarding. Fix those before polishing anything.

---

## 1. Card-network monitoring: it measures the wrong thing

**1.1 The "network ratio" is not Visa's ratio.** Since April 2025, Visa's Acquirer Monitoring
Program (VAMP) counts **fraud reports (TC40) plus disputes (TC15)** against **settled card-not-present
transactions (TC05)**, by calendar month and by count
([Basis Theory](https://blog.basistheory.com/visa-acquirer-monitoring-program-2026-updates),
[cside](https://cside.com/blog/vamp-2026-merchant-playbook),
[Disputed](https://disputed.ai/resources/guides/understanding-vamp-thresholds)). Sentinel divides
chargebacks received by all settled transactions over a rolling 30 days
(`lib/domain/metrics/context.ts`, `cb_ratio_30d`). It has no fraud reports at all, so a merchant
whose cardholders report fraud without disputing is invisible, and card-present volume inflates the
denominator. Summaries disagree on whether a fraud dispute with a matching TC40 counts once or twice
([Payfasto](https://payfasto.com/visa-vamp-explained/),
[Mentom](https://mentompayments.com/insights/visa-vamp-guide)); a tool should let policy decide,
not pretend the question does not exist.

**1.2 Mastercard is calculated differently again, and Sentinel doesn't split by brand.** The
Excessive Chargeback Merchant program divides chargebacks in a calendar month by Mastercard
transactions in the **previous** month, with a 100-chargeback floor
([Chargebacks911](https://chargebacks911.com/mastercard-chargebacks/mastercard-excessive-fraud-chargeback-monitoring-programs/mastercard-ecm-program-how-to-calculate-your-mastercard-chargeback-rate/),
[Solidgate](https://docs.solidgate.com/risks/monitoring-programs/mastercard/),
[CCBill](https://ccbill.com/doc/mastercard-excessive-chargeback-program)). Transactions in Sentinel
have no card brand, so neither program can be computed. A blended ratio of 1.2% can hide a
Mastercard ratio of 2% on a merchant whose cardholders skew Mastercard.

**1.3 The payfac's real exposure is its portfolio ratio, which Sentinel never shows.** VAMP's
merchant-level "Excessive" tier needs 1,500 or more fraud reports and disputes in a month
([GivePayments](https://www.givepayments.com/resources/visa-vamp-2026/),
[BeastInsights](https://beastinsights.com/blog/vamp-thresholds)). Glow, the dispute story, settles
about 8,400 transactions a month: at 1.55% it produces about 130 counts and will never be
identified by Visa on its own. What it does is push the **acquirer's** ratio towards the 0.5% and
0.7% tiers, and the sponsor acquirer passes that on to the payfac. The head of risk needs "portfolio
VAMP ratio, and the five merchants contributing most to it". The portfolio report has neither.

**1.4 Dead policy.** `network.minChargebacks = 100` sits in policy v1 and is read by nothing; the
real floor is a hard-coded `10` in `R-CB-NETWORK-PROX` and in `lib/queries/portfolio.ts`. An admin
who changes it in the policy editor changes nothing, and the audit log says they did.

**1.5 Card testing is a proxy, and that is fine, but say so.** VAMP also has an enumeration ratio
(enumerated authorisations over all authorisations)
([IntelliPay](https://intellipay.com/vamp-compliance-guide-post-april-2026-intellipay/)).
Sentinel cannot tell which attempts the network will classify as enumeration; `R-CARD-TESTING`
(many tiny authorisations with a high decline rate) is the honest substitute. Left as is.

## 2. Compliance: two holes a sponsor-bank audit would find

**2.1 The terminated list is write-only for people.** Terminating Nimbus writes the merchant and
its principals to `TerminatedListEntry` (`lib/domain/offboarding/service.ts`). Onboarding checks
that list only for the **merchant**, and only by exact registration number
(`lib/domain/scoring/service.ts`). Principals are screened against the mock vendor list and never
against the internal entries. So the owner of a merchant terminated for fraud last month can open
a new company tomorrow and pass every check. MATCH exists precisely for this: acquirers must query
it for the merchant **and its principals** before boarding
([Corefy](https://corefy.com/glossary/match-list-mastercard),
[Chargeback.io](https://www.chargeback.io/blog/what-is-the-tmf-match-list)).

**2.2 Listing is optional when it shouldn't be, and allowed when it shouldn't be.** "Add to the
terminated list" is a checkbox, off by default, for every termination category. For MATCH-type
reasons (fraud, excessive chargebacks, laundering, violation of standards) listing is an
obligation, and listing a merchant who simply asked to leave is a liability
([Paystand](https://support.paystand.com/hc/en-us/articles/5080580880283-High-Risk-Merchant-Lists-and-MATCH)).
The category already tells the system which case it is.

**2.3 Screening happens once.** Owners are screened at submission and never again. Sanctions
lists change daily; there is no prescribed rescreen interval, but monthly batch rescreening plus
rescreening on any ownership change is the common baseline
([Flagright](https://flagright.com/post/understanding-sanctions-and-sanctions-screening),
[CheckLynx](https://checklynx.com/en/resources/guides/when-to-rescreen-suppliers-for-sanctions),
[Alessa](https://alessa.com/?p=26769)). A person designated in November who owns an active merchant
keeps getting payouts until their merchant's next periodic re-score, which is 12 months away for a
LOW merchant.

**2.4 The OFAC 50% rule: not a gap, but worth stating.** Any confirmed sanctions hit on any owner
is already a hard stop, which is stricter than aggregating blocked ownership to 50%. The ownership
tree has a `parentOwnerId` field but no screening of intermediate companies; for a payfac boarding
small merchants that is acceptable for v1 and recorded in `DECISIONS.md`.

## 3. Monitoring after onboarding stops at the transactions

**3.1 The website is checked once.** Ongoing website monitoring is a named section of Visa's
payfac risk guide and a standard product category (LegitScript, Ballerine's web monitoring)
([Visa PF & Marketplace Risk Guide](https://usa.visa.com/content/dam/VCOM/regional/na/us/partner-with-us/documents/visa-payment-facilitator-and-marketplace-risk-guide.pdf),
[Infinicept + LegitScript](https://www.globenewswire.com/news-release/2023/03/15/2627580/0/en/Infinicept-and-LegitScript-Partner-to-Provide-Comprehensive-Merchant-Risk-Monitoring.html),
[Ballerine](https://ballerine.com/industries/merchant-acquiring)). The classic transaction-laundering
pattern (approved as a candle shop, quietly selling something prohibited) is invisible to every
rule in Sentinel, because the transactions look like a candle shop's.

**3.2 The declared profile can never be updated.** `R-VOL-OVER-PROFILE` compares volume with the
monthly volume the merchant declared at onboarding. A merchant that legitimately doubles has no
path to a new profile, so an analyst dismisses the same alert every week forever. This is the
single most common way rule noise starts in real teams.

## 4. Positioning: who would buy this instead of what

The market splits into onboarding/KYB (Middesk, Alloy), transaction monitoring with case
management (Unit21), web and content monitoring (LegitScript) and acquirer-focused risk platforms
(Ballerine, Gratify)
([Gratify vs Ballerine](https://www.gratifypay.com/versus/ballerine),
[FintechSpecs](https://fintechspecs.com/blog/merchant-onboarding-software-payfacs-isvs/),
[Fraud.net](https://www.fraud.net/resources/top-merchant-fraud-monitoring-software)). Sentinel's
honest pitch is the **lifecycle in one place with money attached**: the reserve preview, four-eyes
and the reconciled offboarding are things a stitched-together stack does badly. That pitch only
holds if the network numbers are right (section 1); otherwise it is a nicer-looking spreadsheet.

## 5. Product and interface

- **The network watchlist answers a question nobody asks.** A risk lead asks "which merchants put
  us at risk with Visa and with Mastercard this month?", not "who is near 1.5% blended".
- **Rolling 30 days against calendar-month programs.** Both are useful (the rolling figure is an
  early warning, the calendar figure is what gets assessed), but the screen has to say which is
  which. Today it shows one number with no basis.
- **The merchant overview has no network line at all;** the analyst has to open the chart.

## 6. Engineering

- Each e2e and integration run clones a 100 MB database and never drops it. Twenty runs, two
  gigabytes, on a disk with a fixed allowance.
- The public RFI portal has no rate limit (tokens are long and random, but the upload endpoint
  takes 10 MB per request from anyone holding a link).
- Performance was measured at 200 merchants and 450k transactions, not the PRD's 2,000 and 1M.
  Lists and Merchant 360 are fast at this scale; nothing proves they are at ten times.
- i18n message files: still not done.

---

## What changed after this review

| # | Finding | Change |
|---|---|---|
| 1.1-1.2 | Wrong network ratios | Transactions carry card brand and channel; fraud reports (TC40-style) are simulated and stored. New metrics: Visa VAMP ratio (fraud reports + disputes over settled CNP, Visa only, rolling 30 days and last calendar month, double counting set by policy) and Mastercard ECM ratio (chargebacks this month and last month over Mastercard transactions in the month before). |
| 1.3 | No portfolio view | Portfolio report shows the portfolio VAMP ratio against the acquirer tiers, and the merchants contributing most to it. |
| 1.4 | Dead policy | Network policy rewritten per program (thresholds, count floors, early-warning share, VAMP double counting); every value is read by a rule or a report. |
| 1.1, 5 | Watchlist and overview | `R-CB-NETWORK-PROX` becomes the VAMP early warning; new `R-MC-ECM`. Network watchlist shows VAMP and ECM side by side with their basis; the merchant overview shows both. |
| 2.1 | Terminated list write-only | Owners are screened against the internal terminated list too (name similarity or ID number); merchants by registration number or legal name. New checklist item: terminated-list inquiry for merchant and principals. |
| 2.2 | Optional listing | Listing is required for fraud, excessive chargebacks, product-policy and compliance terminations and refused for merchant request and inactivity. |
| 2.3 | Screening once | Monthly rescreening of every owner of a processing merchant, plus rescreening when a new list version is published. New hits open a watchlist case. The mock list gains a dated designation so the demo shows it. |
| 3.1 | Website once | Weekly website monitoring (mock crawler with dated content changes); a site that goes offline, drops its policies or shows products outside its MCC raises an alert and a case. |
| 3.2 | Profile frozen | Senior analysts and the head of risk can update the declared profile (volume, ticket, delivery days) with written evidence; the change is audited before and after and re-scores the merchant at once. |
| 6 | Test databases, portal | Test runs drop their cloned databases (3.5 GB of leftovers were removed); the portal has a per-address and per-link rate limit. |
| 6 | Scale, i18n | Not changed: still measured at 200 merchants, still English-only. Both stay in `DECISIONS.md` under "Not done". |

## Found while fixing

Doing the work turned up three more defects, all fixed and covered by tests:

- **The seed was not deterministic.** The simulator keyed its randomness on database ids, which are
  random, so two seeds of the same code produced different transactions and alerts. It now keys on
  registration numbers; two seeds now match exactly.
- **A SQL NULL hid terminated principals.** `NOT (merchantId = x)` silently dropped list entries with
  no merchant attached. Caught by the integration test for ID-number matching.
- **The list version never changed.** Sorting `"base"` after ISO dates meant a new designation did not
  trigger a rescreen. Caught by a unit test.
