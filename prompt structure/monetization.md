# JobsKart — Monetization Model

Revenue is employer-side only. Two currencies: **plan entitlements** (recurring) and **credits** (prepaid top-up).

---

## 1. Job tiers

| | Classic | Classic+ | Trending |
|---|---|---|---|
| Purpose | General hiring | Continuous/bulk hiring | Urgent / premium |
| Live duration | 30 days | 30 days | 30 days |
| Close & reopen | Yes | Yes | Yes |
| Repost after expiry | Only per plan rules | Yes, multiple times | Only per plan rules |
| Visibility | Normal | Normal | Elevated ranking + premium placement + stronger recommendations |
| Available in | Basic / regular plans | Unlimited plans (with live-job cap) | Basic / regular plans |

Key subtlety: **Classic+ is not "better visibility"** — it is *reusability* under an unlimited plan, capped by concurrent live jobs. Trending is the visibility product. Do not let the UI imply Classic+ ranks higher; it does not.

Entitlement resolution order when posting:
1. Plan grants the tier this month → consume plan quota, `tier_source='plan'`
2. Plan exhausted, wallet has credits → consume credits, `tier_source='credits'`
3. Neither → block with an upgrade prompt naming the exact shortfall

Live-job cap (`limits.live_jobs_max`) is checked against `status='active'` count **before** any deduction.

---

## 2. Boost

Boost is temporary visibility on top of an existing job. It does not change tier.

| Rule | Behaviour |
|---|---|
| Same-day restriction | A job cannot be boosted on the calendar day it goes live — new jobs already carry freshness priority. Enforced by comparing IST dates |
| Credit-based | Consumes boost credits from plan allocation, then wallet |
| Multiple usage | Allowed on different days; enforced by a unique index on `(job_id, IST date)` |
| Temporary priority | Adds a decaying bonus for `boost_window_hours` (default 24) |
| Dynamic priority | Boost is a bonus, not an override — a strongly matching or newer job can still outrank a boosted one |

Boost bonus decays linearly across the window:
`boost_bonus = boost_bonus_max × (1 − elapsed / window)`

This matters: a flat bonus makes boosted jobs sticky at the top for the full window and degrades feed quality. Decay gives the burst without the staleness.

**Refund rule:** if a job is closed or removed by admin within 2 hours of boosting, refund the boost credits. Otherwise no refund. State this in the confirm dialog *before* the deduction, not after.

---

## 3. Candidate database unlocks

**Access gate:** the candidate database is not a standalone product. A recruiter must select an **active** live job before searching. No search on expired, paused, closed, or draft jobs. This is a deliberate coupling — it ties data access to genuine hiring intent and limits scraping.

**Inventory:** each job carries an unlock allowance (default 25, from `plans.limits.unlocks_per_job`).

**Consumption order:**
1. Candidate already unlocked by this company (any job, any recruiter) → **free**, instant
2. Job allowance remaining → consume 1 allowance
3. Allowance exhausted → consume `plan_settings.credits_per_unlock` (currently 5) from the wallet
4. Wallet empty → block with top-up prompt

**Why rule 1 exists:** without it, two recruiters in the same company working two jobs both pay for the same candidate. That is the single most common credit-refund complaint on platforms of this type. The `UNIQUE (company_id, candidate_user_id)` constraint already in the schema makes it free to implement.

**Expiry:** unused allowance expires with the job. Not transferable. Say so in the UI at post time, not at expiry.

**What unlock reveals:** phone, email, full resume file, complete work history. Until unlock: name initials, city, experience band, skills, match score, tags. Never send locked fields to the client (see `architecture.md` R3).

---

## 4. Response retention

Employer access to a job's responses ends **60 days after job expiry**.

- On expiry: set `responses_purge_at = expires_at + 60 days`
- At 7 days before purge: notify all company members, show a persistent banner on the responses screen with a Download CSV action
- At purge: flip `applications.employer_visible = false` for that job

The candidate's own application history is untouched. This is a visibility revocation, not a deletion — important for any future dispute.

---

## 5. Free tier

Existing `plan_settings` already defines it: free posting enabled, 50-response cap, 500 WhatsApp sends per post, Rajasthan-only WhatsApp, 30-day validity, 10 jobs/hour spam limit.

Recommended free-tier additions for launch: `unlocks_per_job: 0` (free posts get responses, not database access) and `trending_posts_per_month: 0`. Database access is the paid product; giving it away free removes the reason to buy.

---

## 6. Numbers still needed from the client

These are pricing decisions, not engineering ones. Everything above works with any values — they live in `plans.limits` and `plan_settings` and are admin-editable without a deploy.

- Price per plan tier and what each plan grants (posts, unlocks, boosts, live-job cap)
- Credit cost of a Trending post and of a boost
- Credit pack pricing ladder
- Whether HR Admin may spend credits or only Super Admin (deck says "Limited/Optional" — needs a decision; see `rbac.md`)

Build with the defaults in `schema.md §2.1`; swap real numbers in via admin before launch.
