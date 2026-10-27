# Sentinel — design brief

Written by the product designer before any markup. It records the research, the style chosen from
tasteskill v2 (`references/app-screens.md`, `library/app.json`), and the one question each screen
answers. Engineering decisions live in `DECISIONS.md`.

## 1. Research summary

### 1.1 What a payfac risk team actually does all day

- Long sessions, desktop, two monitors. An analyst works an alert/case queue for 6-8 hours; a head of
  risk glances at the portfolio a few times a day and approves a handful of high-impact actions.
- The expensive mistakes are not slow decisions, they are **inconsistent** and **unexplained** ones:
  a reserve nobody can justify to sales, a payout hold an auditor cannot reconstruct, two analysts
  scoring the same merchant differently. The interface has to make the reason visible next to every
  number and every button.
- Bad outcomes surface **after onboarding** (weeks 2-8 of processing). So the merchant record is a
  living file, not an application form: the score, its factors, controls in force and the decision
  history belong in one header.
- Money at risk is a function of time. Future-delivery merchants (travel, tickets, pre-orders) carry
  exposure equal to daily volume × days until delivery, plus the dispute window. A reserve only makes
  sense when shown against that exposure.

### 1.2 External rules that move (and so are configuration, not code)

Card-network monitoring thresholds change often and third-party sources disagree. At the time of
writing, summaries of Visa's VAMP cite a merchant "excessive" ratio of 1.5% (from April 2026 in most
regions, 2.2% in CEMEA), while one source cites 0.9%; Mastercard's ECM is commonly cited at
150 bps with ≥100 chargebacks, with a staged tightening proposed from 2027. Sentinel therefore stores
each program's lines in `Policy.params.network` with the label **"Verify against current network
rules"** and shows that label wherever a number is used.

The two programs are calculated differently, and Sentinel calculates each as its network does
(after the review in `ROAST.md` §1): Visa VAMP is fraud reports plus disputes over settled
card-not-present Visa sales, by calendar month (Sentinel also shows a rolling 30 days as the early
warning); Mastercard ECM is a month's chargebacks over the previous month's Mastercard sales. The
payfac's sponsor acquirer is assessed on the portfolio's VAMP ratio (0.5% / 0.7% tiers), so the
portfolio screen leads with that figure and its largest contributors. ETA's Payment Facilitator Guidelines
(3rd ed.) shape the checklist: sub-merchant underwriting policy, periodic review, change monitoring
and enhanced due diligence for higher-risk merchants.

Sources: chargeflow.io (VAMP 2025 guide, Mastercard ECM/GMAP), chargebackgurus.com (VAMP change),
easypaydirect.com (VAMP 2026), support.bluesnap.com (monitoring programs), electran.org (ETA
underwriting guidelines).

### 1.3 Design principles derived from it

1. **No number without its reason.** The score is never shown without its factor ledger; exposure
   never without its components; a control never without its reason code and review date.
2. **Show the consequence before the click.** Every action that touches money or status states what
   will happen, to whom, for how long, and whether a second person must approve.
3. **Colour is meaning, never decoration.** Risk band, severity and SLA are the only colours, always
   paired with a word. Fine things are grey.
4. **The merchant is a person.** Merchant-facing text is written separately, in plain language, and
   previewed beside the internal reason.

## 2. Style (tasteskill v2, app screens)

| Decision | Choice | Why |
|---|---|---|
| Kind | `finance` + `support` (queues) | Money at risk and work queues |
| Style | **Achromatic ledger** (light) | Long sessions on money; the chrome carries no colour so risk colours carry meaning instantly |
| Shell | Open plane: 240px labelled sidebar on the ground, no top bar | Nine destinations, labels beat icons for a back office |
| Theme | Light default, true-neutral dark (`data-theme="dark"`) | PRD asks for both |
| Face (identity) | A **blue-grey ledger ground** `#f2f4f7`, white sheets, and **Geist Mono on every money figure and ID** | Money reads as a ledger's columns; analysts compare digits |
| Data hue | `#1d5fbf` on the main data element only (the volume line, the current score marker, reserve fill) | One hue, under 1% of pixels |
| Type | Geist (text) + Geist Mono (IDs, money). Sizes 12/14/16/24, KPI 28 | Two faces with one job each |
| Radius | Tight: cards 8, controls 6, chips 4 | Bimodal rule |
| Primary | Near-black `#141414`, one per screen | No brand-coloured buttons |

### 2.1 Signature element: the score ledger

Sentinel's one element no template has: **the risk score drawn as an addition**. Each factor is a
ledger row (label, the input in words, points / max, a thin bar), the rows sum to the total, and a
0-100 strip under the total marks the band thresholds from the policy version that produced it.
Hard stops print above the sum as a black "Prohibited" line, because they override arithmetic.

The second product-specific element is **exposure against reserve**: one track as long as total
exposure, split into future-delivery and dispute segments, with the reserve balance drawn as the
filled part and coverage written as a percentage.

### 2.2 Semantic colour map

| Meaning | Light | Text pair |
|---|---|---|
| Band LOW | neutral pill `#eceef1` / `#3d3d3d` | "Low" |
| Band MEDIUM | warning pill `#fffbeb` / `#92400e` | "Medium" |
| Band HIGH | negative pill `#ffedea` / `#831c1e` | "High" |
| Band PROHIBITED | ink pill `#141414` / `#ffffff` | "Prohibited" |
| Severity CRITICAL | ink pill (rare by design) | "Critical" |
| SLA breached | `--negative` text + "Breached 3 h ago" | words always |
| SLA < 2 h | `--warning` text | "1 h 40 m left" |

## 3. Screens and their one question

| Screen | One question | Biggest block | Main job, one click away |
|---|---|---|---|
| Dashboard | What needs me today? | My cases ordered by SLA | Open the next case |
| Queue | Which item do I work next? | The table, SLA column first-sorted | Assign to me (`a`) |
| Merchant 360 | How risky is this merchant right now, and why? | Header + score ledger + exposure | Add control / open case |
| Underwriting review | Can I decide this application, and what is missing? | Checklist | Decide (locked until complete) |
| Case detail | What happened, and what should we do? | Evidence + timeline | The action panel with consequences |
| Control editor | What will this control do to the merchant's cash? | 90-day impact preview | Save / request approval |
| Approvals | Should I approve this, and what happens if I do? | The "if approved" summary | Approve / Reject with note |
| Rules Studio | Would this rule catch the right merchants? | Backtest chart vs active version | Save version (change note) |
| Portfolio | Where is our exposure, and who puts us at risk with Visa and Mastercard? | Exposure vs reserve by band; portfolio VAMP and the network watchlist | Open the merchant |
| Audit | Can I prove who did what, and is the log intact? | The log table | Verify integrity |
| RFI portal | What do I need to send, and by when? | The list of documents | Upload |

## 4. House rules applied

- No KPI tiles with icons, no sparklines, no gradients, no shadows at rest, no zebra tables,
  sentence-case 12px grey table headers, numbers right-aligned in tabular figures.
- Missing values are a grey dash; zeros print as zeros.
- Every data block has empty, loading (flat grey bars at real size, no shimmer) and error states.
- Phone: sidebar folds into a 48px bar with a menu sheet; tables become two-line rows.
- Charts: one series per chart, 3-5 faint gridlines, no y-axis line, straight segments, annotated
  events (alerts, controls) as 1px markers with labels.
