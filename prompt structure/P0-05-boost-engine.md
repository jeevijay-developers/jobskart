# P0-05 — Boost Engine

Boost is temporary visibility on an existing job. It does not change the job's tier. Requires P0-04.

## Rules

| Rule | Behaviour |
|---|---|
| Same-day restriction | A job cannot be boosted on the calendar day (IST) it went live — new jobs already have freshness priority |
| Credit-based | Consumes boost credits from the plan allocation first, then the wallet |
| Multiple usage | Allowed on different days |
| Temporary priority | Adds a **decaying** bonus over the boost window (default 24h) |
| Dynamic priority | Boost is a bonus, not an override — a stronger match or a newer job can still outrank a boosted job |

## Migration
```sql
CREATE TABLE IF NOT EXISTS public.job_boosts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  applied_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  credits_spent int NOT NULL DEFAULT 0,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_boosts_active_idx ON public.job_boosts (job_id, ends_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS job_boosts_one_per_day
  ON public.job_boosts (job_id, ((starts_at AT TIME ZONE 'Asia/Kolkata')::date));

ALTER TABLE public.job_boosts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read own boosts" ON public.job_boosts FOR SELECT
  USING (public.has_company_membership(auth.uid(), company_id));
```

`jobs.boosted_until` becomes a denormalised cache of `max(ends_at)`, maintained by trigger on `job_boosts`. App code must never write it directly.

## RPC — `apply_boost(_job_id uuid)`
`SECURITY DEFINER`. In one transaction:
1. Load the job, verify membership, verify `status='active'`
2. If `created_at::date (IST) = current_date (IST)` → raise `boost_same_day`
3. If a boost already exists for this job today → raise `boost_already_today`
4. Check role permission (see P0-10: recruiters may boost only their own jobs, capped monthly)
5. Resolve boost credits: plan allocation this month → else wallet. Insufficient → raise `insufficient_credits`
6. Insert the boost row with `ends_at = now() + boost_window_hours`
7. Deduct via `apply_credit_delta()`, log to `employer_activity`

## Decay
`boost_bonus = boost_bonus_max × (1 − elapsed_hours / window_hours)`, floored at 0. Defaults in `match_scoring_config`: `boost_bonus_max: 30`, `boost_window_hours: 24`.

A flat bonus would pin boosted jobs to the top for the full window and degrade the feed. Decay gives the burst without the staleness.

## Refunds
If the job is closed by the employer, or removed by an admin, **within 2 hours** of boosting, refund the credits and mark the boost `ends_at = now()`. Otherwise no refund. State this rule in the confirmation dialog **before** the deduction, not after.

## UI
- Boost button on the employer jobs list and the job detail page
- Disabled with the reason inline when unavailable: "Available tomorrow — new jobs already get top placement today"
- Confirmation dialog shows: credits cost, current balance, balance after, boost duration, and the 2-hour refund rule
- Active boost shows a live countdown: "Boosted · 14h remaining"
- Boost history on the job detail page: date, applied by, credits spent

## Acceptance
- [ ] Boosting a job posted today is rejected with a clear message
- [ ] Boosting twice on the same day is rejected
- [ ] Boosting on a later day succeeds and deducts credits once
- [ ] Two rapid clicks deduct exactly one boost's worth of credits
- [ ] `jobs.boosted_until` updates via trigger and matches `max(ends_at)`
- [ ] The bonus decays over the window rather than dropping off a cliff
- [ ] Closing the job within 2 hours refunds the credits
