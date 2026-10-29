# Sentinel

Merchant risk lifecycle workspace for a payment facilitator's risk team: underwriting, rules-based
monitoring, cases, controls and reserves, four-eyes approvals, offboarding, and a hash-chained audit
log. Every risk decision is deterministic and explained factor by factor; there is no AI or ML.

- Product spec: the PRD this was built from (phases F0-F10).
- `DESIGN.md`: research, the design brief, and the question each screen answers.
- `DECISIONS.md`: assumptions and choices where the PRD left room, and what is not done.
- `ROAST.md`: a candid review against card-network rules, MATCH, sanctions practice and the market, and what changed because of it.

## Run it

Requirements: Node 22, PostgreSQL 16 (or Docker).

```bash
npm install
cp .env.example .env            # set AUTH_SECRET to 32 random bytes
make db                         # or use any local Postgres 16; set DATABASE_URL
npx prisma migrate deploy
npm run seed                    # resets the database, then seeds (~80 s)
npm run dev                     # http://localhost:3000
```

Sign in by choosing a persona. The demo runs on a simulated calendar starting 27 Oct 2026:

```bash
npm run demo:advance-day                 # simulate a day of trading and run every job
npm run demo:advance-day -- --days 30    # several days
npm run worker                           # the pg-boss worker with the real schedules
```

## Demo mode: no database needed

Without `DATABASE_URL`, Sentinel runs on an embedded Postgres (PGlite, Postgres compiled to
WebAssembly) loaded from a snapshot of the seeded mock data: 200 fictional merchants, 120 days of
daily metrics, the last 45 days of raw transactions (~180k), disputes, fraud reports, cases,
alerts and an intact audit chain. Every service, rule, approval and audit check runs unchanged.
Changes live in memory and reset when the server restarts.

```bash
npm run mock:build     # build .mock-db/sentinel.tar.gz (~100 s, 22 MB)
npm run dev:mock       # or: SENTINEL_MOCK=1 next start
npm run test:demo      # the demo journey end to end, with no database
```

The home page (`/`) is a landing page in Bahasa Indonesia (English on `/?lang=en`): the problem
a payment aggregator has, the flow of a card payment, what Sentinel does, real screenshots, the
people, the five stories and a short FAQ. The sign-in page leads with the five stories: each button signs in as the right person and opens
the screen where the work starts. The dashboard's demo guide tracks each story and hands the next
step to the next person ("Continue as Laura"). **Next day** in the sidebar simulates a day of
trading and runs every daily job.

### Deploy to Vercel

Import the repository and deploy; no environment variables, no database, no settings. Verified
with `vercel build` from a clean checkout and no environment. The `vercel-build` script
builds the mock database snapshot when `DATABASE_URL` is absent, and the app starts in demo mode
(first request on a cold instance: about 1.5 s to load the snapshot).

For a real database instead, set `SENTINEL_MODE=database`, `DATABASE_URL` (hosted Postgres 16),
`AUTH_SECRET` (`openssl rand -base64 32`) and `AUTH_TRUST_HOST=true`; the build then runs
`prisma migrate deploy`. Without `SENTINEL_MODE=database`, a Vercel deployment stays in demo mode
and ignores any `DATABASE_URL`. Seed once from your machine with `DATABASE_URL="<url>" npm run seed:only`.

Limits of demo mode on serverless: each instance holds its own copy, so changes can differ
between instances under load and disappear on a cold start; merchant-portal uploads go to `/tmp`.

## The five stories

| | Merchant | Who | What to do |
|---|---|---|---|
| S1 | Lumen Travel Co. | Dimas (senior underwriter), then Laura | Underwriting · Enhanced → finish the checklist → approve with a 10% / 120-day rolling reserve from the impact preview → Laura approves it in Approvals |
| S2 | Brightside Electronics | Rina (analyst) | My work → the volume-spike case → request documents → open the portal link as the merchant and upload a PDF → add a daily limit → close the case |
| S3 | QuickTop Gift Cards | Rina, then Laura | Unassigned → the CRITICAL card-testing case → add a payout hold (four-eyes) → Laura approves |
| S4 | Glow Subscription Box | Laura, Dimas | Portfolio → network watchlist → Glow's dispute case → fixed reserve over $50,000 → Laura approves |
| S5 | Nimbus Supplements | Rina, then Ahmad (compliance) | The watchlist case → propose termination (compliance; the business and principals are listed) → Ahmad approves → `npm run demo:advance-day -- --days 121` → terminated, reserve reconciled |

After the review (`ROAST.md`), three things also happen as the calendar moves:

- **1 Nov**: a sanctions list update names the owner of Beacon Consulting; the monthly rescreen finds it and opens a critical watchlist case (`--days 5`).
- **2-8 Nov**: Thistle Flower Co.'s website starts selling prescription medicines and drops its refund policy; weekly website monitoring raises an alert (`--days 12`).
- **Any day**: Portfolio shows the portfolio's Visa VAMP ratio against the acquirer tiers. In the seeded history, Alder Lodge raised a VAMP warning at 1.87% on 22 Oct while its blended chargeback ratio (0.63%) was under even the internal 0.75% line.

## Tests

```bash
npm test                    # unit: scoring, rules DSL, VAMP/ECM, reserves, state machines, four-eyes, audit hash, monitors
npm run test:coverage       # ≥ 90% on the pure engines
npm run seed:template       # once: seeds the sentinel_tpl database the next two clone
npm run test:integration    # preview vs. ledger after 30 days; rescreening, website monitoring, terminated list
npm run test:e2e            # Playwright: S1-S5, RBAC, PII masking, audit tamper detection, axe
                            # (test runs clone sentinel_tpl and drop the clone afterwards)
```

## Layout

```
app/(internal)/…   staff screens            app/(portal)/…   merchant RFI portal
app/api/v1/…       JSON API (Zod, RBAC)     lib/domain/…     engines and services
lib/sim/…          transaction simulator     jobs/…           worker, advance-day, simulate
prisma/            schema, migrations, seed  tests/           unit, integration, e2e
```
