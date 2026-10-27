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
| Network threshold is policy, default 1.5%, labelled "Verify against current network rules" | Published summaries of Visa VAMP / Mastercard ECM disagree and change (see `DESIGN.md` §1.2). |
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
| Story chargebacks are scripted by **receipt** date | So the 30-day ratio follows the story exactly (Glow climbs to ~85% of the line; Nimbus holds ~1.1%). Background merchants draw chargebacks probabilistically 12-50 days after the sale. |
| Monitoring history covers the last 30 days | Longer windows left story cases open for months, which reads as negligence rather than a story. Rule-precision stats grow as the demo is used. |

## Testing

| Decision | Why |
|---|---|
| Unit coverage gate (≥ 90%) is on the pure engines | `scoring/index.ts`, `rules/dsl.ts`, `reserves/calc.ts`, both state machines, `approvals/policy.ts`, `audit/hash.ts`, `money.ts` (98.7% lines). Their DB-backed services are covered by `tests/integration` and `tests/e2e` against a real database. |
| Each e2e or integration run clones a seeded template database (`sentinel_tpl`) | Tests mutate freely and never touch dev data; nothing has to be reset. |
| "Preview matches reality after 30 days" is tested two ways | Exact: the ledger equals the same simulation fed with the volume that actually happened. Approximate: the 30-day projection was within 15% of reality (volume differs from the projection by nature). |

## Not done, or partly done

| Item | State |
|---|---|
| i18n message files (PRD §10) | **Not done.** UI copy is inline English; numbers, money and dates already go through `Intl`. Moving strings into message files is mechanical but touches every screen. |
| Auditor export of the whole log above 50,000 rows | Export is capped at 50,000 rows per request; filters narrow it. |
| `make dev` with Docker Compose | Written (`docker-compose.yml`, `Makefile`) but not run in this environment; development here used a local Postgres 16. |
| Merchant data edits triggering a re-score | Re-scoring runs on onboarding, watchlist reviews, periodically and manually. There is no screen to edit a merchant's declared profile yet, so the "data changed" trigger has no caller. |
| Rate limiting on the public portal | Tokens are 32 random bytes and expire; no rate limiter is in front of the portal. |
