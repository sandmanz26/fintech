# Decisions and assumptions

Where the PRD left room, the simplest option that meets the acceptance criteria was chosen and
recorded here. Design decisions are in `DESIGN.md`.

## Platform

| Decision | Why |
|---|---|
| Next.js 15.5 (App Router), React 19, Prisma 6, pg-boss 10, Auth.js v5 beta, Tailwind v4 | PRD asks for Next 14+; these are current, stable majors with known APIs. Prisma 7 changed its config model and was avoided. |
| shadcn/ui is followed as a pattern, not installed | Components are small local files on Radix primitives (dialog, dropdown), styled with the app's tokens. Same idea as shadcn, no CLI or registry needed. |
| Recharts for time series, plain SVG/HTML for the score strip and exposure track | Recharts is configured to the chart rules in `DESIGN.md` (round ticks, faint grid, straight segments, annotated events). Every chart has a data table for screen readers and a "Show table" toggle. |
| Demo login: one click per persona (Auth.js Credentials, JWT session) | PRD §4.1. Swapping to SSO changes only `auth.ts`. |
| RBAC lives in `lib/auth/rbac.ts` and is checked in route handlers **and** services | The UI reads the same table only to hide controls. Pages a role may not use render a "Not available for your role" screen. |

## Demo mode (no backend)

| Decision | Why |
|---|---|
| Without `DATABASE_URL` the app runs on PGlite (Postgres in WebAssembly) behind a local socket, loaded from a seeded snapshot | "No backend" without rewriting ~60 services against a fake: the same Prisma queries, triggers, advisory locks and audit chain run on real Postgres semantics. Verified: the seed produces identical counts on PGlite and Postgres 16. |
| The snapshot keeps 45 days of raw transactions (plus any with a dispute or fraud report) and all 120 days of daily metrics | 22 MB compressed, ~1.5 s cold start, ~700 MB memory, instead of 59 MB / 9 s / 1.4 GB for everything. Charts, ratios and rules read the daily metrics. |
| Demo mode signs JWTs with a fixed, public secret when `AUTH_SECRET` is unset | Login is a persona click on fictional data; a real deployment sets `AUTH_SECRET` (and the middleware refuses to run without it outside demo mode). |
| The calendar can be moved from the UI ("Next day") | There is no worker or terminal in a serverless demo. Any persona in demo mode; head of risk or admin otherwise. Audited as `DEMO_DAY_ADVANCED`. |
| Story cases are staged within SLA from the demo's first day; most historical cases are worked and closed | A queue where every case is weeks past SLA reads as a broken product, not a busy team. |

## Time and money

| Decision | Why |
|---|---|
| A simulated calendar (`SimClock`, `lib/clock.ts`) | `npm run demo:advance-day` must move "today". `now()` is the simulated date at the current real time of day. Everything time-sensitive reads it, **including audit timestamps**, so timelines interleave correctly. In production SimClock tracks real time (or is removed). |
| Money is `BigInt` minor units everywhere it is stored, sent (as strings) or summed | PRD §0. The rules engine compares numbers: metric values are minor units converted with a safe-integer check (`toDayRow`). |
| Ratios in the rule DSL are fractions (0.0075 = 0.75%) | One unit across metrics; Rules Studio shows and accepts percentages and dollars and converts. |

## Domain choices

| Decision | Why |
|---|---|
| Ratio rules (chargebacks, refunds, cross-border, volume over profile) re-alert weekly (168 h dedupe); spikes, card testing and dormancy daily | A ratio stays above its line for weeks; daily repeats were noise in testing. Configurable per rule version. |
| `R-CB-NETWORK-PROX` also requires ≥ 10 chargebacks in 30 days | Without a floor, 4 chargebacks on a tiny merchant paged someone (seen in the first seed). The same floor colours figures red in the UI. |
| Network lines are policy per program, labelled "Verify against current network rules" | Visa VAMP merchant 1.5% with a 1,500-count floor, acquirer 0.5% / 0.7%; Mastercard ECM 1.5% with 100 chargebacks; early warning at 80% of a line from 10 counts. Published summaries disagree and change (see `DESIGN.md` §1.2, `ROAST.md` §1). |
| VAMP counts a fraud dispute with a matching fraud report twice by default | Summaries disagree on whether Visa de-duplicates; counting twice is the conservative reading. `network.visa.countFraudDisputesTwice` switches it. |
| VAMP and ECM are computed from per-day, per-brand counts on `DailyMerchantMetric` | Calendar months need up to three months of history; daily counts make the rolling and calendar figures, the merchant header and the portfolio sum one pure function (`networkFigures`). |
| `R-CB-NETWORK-PROX` keeps its key but now watches the rolling Visa VAMP ratio; `R-MC-ECM` is new | The key is referenced by cases, stats and the S4 story; its definition and name changed in a new rule version. The blended chargeback ratio stays as `R-CB-RATIO` (an internal line, not a network one). |
| Card-present: a merchant without a website that hands goods over on the spot | The simulator needs a channel; VAMP counts card-not-present only. Brand comes from the BIN's first digit. |
| Fraud reports are simulated: 80% of fraud disputes are preceded by one, and 0.4 × the merchant's chargeback rate of sales get a fraud report without a dispute | Gives VAMP its own signal (Alder Lodge in the seed: 0.63% blended, 1.87% VAMP on 22 Oct). |
| Terminated-list listing follows the termination category | Fraud, excessive chargebacks, product policy and compliance are listed; merchant request and inactivity are not. The dialog states it instead of offering a checkbox. |
| Owners are screened against the internal terminated list by exact ID number or name similarity ≥ 75 | The same line as the vendor mock. A merchant matches by registration number or exact legal name and is a hard stop; a principal match is a hit to review, like any other. |
| Ongoing screening: every owner of a processing merchant, whenever the list version changes and at least every 30 days | No fixed interval is prescribed; monthly plus on list updates is the common baseline. New hits raise `R-WATCHLIST-RESCREEN` (CRITICAL for sanctions). There is no screen to edit owners, so "rescreen on ownership change" has no caller yet. |
| The OFAC 50% rule is not modelled | Any confirmed sanctions hit on any direct owner is already a hard stop, which is stricter. Intermediate holding companies in the ownership tree are not screened. |
| Website monitoring: weekly per merchant on a weekday fixed by its id; only new findings alert | Spreads crawler load over the week; a site that has been missing a policy since onboarding was a decision at onboarding, not news. |
| System rules (`R-LIMIT-BREACH`, `R-WATCHLIST-RESCREEN`, `R-WEBSITE-CHANGE`) cannot be edited or switched off | Enforced in the service, not only hidden in the UI. |
| Declared profile updates are direct (senior analyst, head of risk) with a written reason, not four-eyes | The change is audited before/after and re-scores at once; a reserve or a hold is still the four-eyes decision. |
| `R-LIMIT-BREACH` is a disabled "system rule" | Limit-control alerts need a `ruleVersionId` (schema). The rule exists for that reference, is never evaluated on metrics, and cannot be edited in Rules Studio. |
| A HIGH or CRITICAL case moves an ACTIVE merchant to UNDER_REVIEW; a heavy control (reserve or payout hold) moves UNDER_REVIEW to RESTRICTED | PRD §7.1 triggers, applied with "transition if allowed" so an ACTIVE merchant with a routine reserve stays ACTIVE. |
| ACTIVE → TERMINATION_PENDING passes through UNDER_REVIEW | The PRD transition table has no direct edge; termination writes both transitions in the same transaction, so the audit shows each. |
| An analyst's reserve below the four-eyes line becomes an approval request instead of a refusal | The matrix gives analysts no direct reserve right but lets them "propose"; a request keeps the work moving. |
| APPROVED_WITH_CONDITIONS whose control needs four-eyes keeps the merchant APPROVED until the control is approved | Going live without the condition that justified approval would defeat it. `activateIfReady` runs when the control activates. |
| A PROHIBITED application stays IN_UNDERWRITING with Decline as the only direct option | "Default DECLINED" is a pre-selection, not an automatic decision: DECLINED is terminal, which would make the PRD's override path impossible. Override goes to the head of risk as OVERRIDE_PROHIBITED. |
| Approving a request resolves the case it came from (CR-CONTROL-APPLIED / CR-TERMINATED); rejecting returns it to In review | PRD §7.2: PENDING_APPROVAL → RESOLVED on approval. |
| Exposure before history: declared monthly / 30 for ADV; prior chargeback ratio (or 0.5%) and 1% refunds for rates | PRD gives the ADV fallback only; the rates fallback is stated in the UI formula. |
| Removing a reserve releases its balance at once, except while offboarding | The reserve existed for that control; offboarding holds everything until the dispute window ends. |
| Reconciliation applies chargebacks received after offboarding with status OPEN, LOST or ACCEPTED to the reserve | Won disputes cost nothing. Any loss above the reserve is reported as `uncoveredLoss`. |
| Watchlist screening is a deterministic token-similarity mock (≥ 75/100 is a match) | Repeatable demos; `nameSimilarity` is replaceable by a vendor adapter behind `WatchlistAdapter`. |
| Seeded owner and merchant names are generated from fictional parts; none collides with the mock lists except the scripted ones | "Semua nama fiktif" (PRD §11). |

## Data and seed

| Decision | Why |
|---|---|
| Seed refuses a non-empty database; `npm run seed` resets first | Re-running a seed on top of data would break the audit chain and the stories. |
| Imported history (merchants, assessments at their decision dates) is written directly, with one `MERCHANTS_IMPORTED` audit row | Replaying 200 onboarding flows through the services would bury the demo's audit log in setup noise. Everything after import goes through services. |
| The simulator's randomness is keyed on registration numbers, not database ids | Ids are random cuids, so two seeds of the same code used to differ (found in the review). Now two seeds produce the same transactions, disputes and alerts. |
| Story chargebacks are scripted by **receipt** date | So the 30-day ratio follows the story exactly (Glow climbs to just under the Visa VAMP line; Nimbus holds ~0.95%, above the internal 0.75% line but under the VAMP early warning). Background merchants draw chargebacks probabilistically 12-50 days after the sale. |
| Monitoring history covers the last 30 days | Longer windows left story cases open for months, which reads as negligence rather than a story. Rule-precision stats grow as the demo is used. |

## Testing

| Decision | Why |
|---|---|
| Unit coverage gate (≥ 90%) is on the pure engines | `scoring/index.ts`, `rules/dsl.ts`, `reserves/calc.ts`, both state machines, `approvals/policy.ts`, `audit/hash.ts`, `money.ts` (98.7% lines). Their DB-backed services are covered by `tests/integration` and `tests/e2e` against a real database. |
| Each e2e or integration run clones a seeded template database (`sentinel_tpl`) and drops it afterwards | Tests mutate freely and never touch dev data. `E2E_KEEP_DB=1` keeps the clone to inspect a failure. |
| "Preview matches reality after 30 days" is tested two ways | Exact: the ledger equals the same simulation fed with the volume that actually happened. Approximate: the 30-day projection was within 15% of reality (volume differs from the projection by nature). |

## Not done, or partly done

| Item | State |
|---|---|
| i18n message files (PRD §10) | **Not done.** UI copy is inline English; numbers, money and dates already go through `Intl`. Moving strings into message files is mechanical but touches every screen. |
| Auditor export of the whole log above 50,000 rows | Export is capped at 50,000 rows per request; filters narrow it. |
| `make dev` with Docker Compose | Written (`docker-compose.yml`, `Makefile`) but not run in this environment; development here used a local Postgres 16. |
| Merchant data edits triggering a re-score | **Done for the declared profile** (volume, ticket, delivery days). Owners and other merchant data still have no edit screen. |
| Rate limiting on the public portal | **Done, in memory per instance**: 60 page loads a minute per address; 20 uploads per link and 30 per address in 10 minutes. Several instances need the same limits in front of them. |
| Performance at PRD scale (2,000 merchants, 1M transactions) | **Not measured.** Measured at 200 merchants and ~450k transactions. |
