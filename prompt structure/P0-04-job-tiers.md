# P0-04 — Job Tiers (Classic / Classic+ / Trending)

Add the commercial tier system to jobs. Note: the existing `job_type` enum is **employment type** (full_time, part_time…) and is unrelated. Tier is a new dimension.

## Tier definitions

| | Classic | Classic+ | Trending |
|---|---|---|---|
| Purpose | General hiring | Continuous / bulk hiring | Urgent / premium |
| Live duration | 30 days | 30 days | 30 days |
| Close & reopen | Yes | Yes | Yes |
| Repost after expiry | Per plan rules | Yes, multiple times | Per plan rules |
| Visibility | Normal | **Normal** | Elevated ranking + premium placement |
| Plan | Basic/regular | Unlimited plans (live-job capped) | Basic/regular |

Important: **Classic+ is reusability, not visibility.** It must not rank higher than Classic. Do not let the UI imply otherwise. Trending is the visibility product.

## Migration
```sql
CREATE TYPE public.job_tier AS ENUM ('classic', 'classic_plus', 'trending');

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS tier public.job_tier NOT NULL DEFAULT 'classic',
  ADD COLUMN IF NOT EXISTS tier_source text NOT NULL DEFAULT 'plan'
      CHECK (tier_source IN ('plan','credits','admin_grant')),
  ADD COLUMN IF NOT EXISTS reposted_from uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS repost_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reopened_at timestamptz;

CREATE INDEX IF NOT EXISTS jobs_tier_status_idx
  ON public.jobs (tier, status) WHERE status = 'active';
```

## Plan entitlements
Store in the existing `plans.limits` jsonb. Add these keys with defaults:
```jsonc
{
  "live_jobs_max": 5,
  "classic_posts_per_month": 10,
  "classic_plus_enabled": false,
  "trending_posts_per_month": 0,
  "unlocks_per_job": 25,
  "boost_credits_per_month": 0,
  "repost_allowed": false,
  "response_retention_days": 60
}
```
Free tier: `unlocks_per_job: 0`, `trending_posts_per_month: 0`.

## RPC — `create_job_with_tier(...)`
`SECURITY DEFINER`, `SET search_path = public`. In one transaction:
1. Verify caller has company membership
2. Lock the company row (`SELECT ... FOR UPDATE`)
3. Count `status='active'` jobs; if `>= limits.live_jobs_max`, raise `live_job_limit_reached`
4. Resolve entitlement for the requested tier: plan quota this month → else credits from the wallet → else raise `tier_not_available`
5. Deduct via `apply_credit_delta()` when the source is credits; set `tier_source` accordingly
6. Insert the job with `expires_at = now() + 30 days`
7. Insert the `job_unlock_allowance` row with `allowance = limits.unlocks_per_job`
8. Log to `employer_activity`

Raise stable error codes: `live_job_limit_reached`, `tier_not_available`, `insufficient_credits`, `insufficient_permissions`.

## Close / reopen / repost
- **Close**: `status='closed'`, set `closed_at`. Does not refund anything
- **Reopen**: allowed while `expires_at > now()`. `status='active'`, set `reopened_at`. Free
- **Repost after expiry**: creates a **new** job row with `reposted_from` set and `repost_count + 1`. Consumes a fresh entitlement, gets a fresh unlock allowance. Classic+ under an unlimited plan reposts without consuming quota; Classic and Trending consume normally

## UI
- Tier selector in the posting wizard, showing what each costs **for this employer's current plan** and what they have left ("3 of 10 Classic posts left this month")
- Trending shown as unavailable with an upgrade link when quota is zero — never hidden entirely
- Tier badge on the employer jobs list and on public job cards (Trending only; Classic and Classic+ get no public badge, since Classic+ is not a candidate-facing benefit)

## Acceptance
- [ ] Posting with quota available consumes plan quota, not credits
- [ ] Posting with quota exhausted but credits available consumes credits and sets `tier_source='credits'`
- [ ] Posting with neither is blocked with a clear message naming the exact shortfall
- [ ] Exceeding `live_jobs_max` is blocked before any deduction occurs
- [ ] Every new job gets a `job_unlock_allowance` row
- [ ] Reposting creates a new row with `reposted_from` set
- [ ] Existing jobs default to `classic` and keep working
