# P0-07 — Candidate Database Access & Unlock Model

The candidate database is not a standalone product. Access is tied to an active job. Requires P0-04.

## Access gate
A recruiter must select an **active** live job before searching. No search on expired, paused, closed, or draft jobs. This ties data access to genuine hiring intent and limits scraping.

## Unlock economics
Each job carries an unlock allowance (default 25, from `plans.limits.unlocks_per_job`).

Consumption order:
1. **Already unlocked by this company** (any job, any recruiter) → **free and instant**
2. Job allowance remaining → consume 1 allowance
3. Allowance exhausted → consume `plan_settings.credits_per_unlock` (currently 5) from the wallet
4. Wallet empty → block with a top-up prompt

Rule 1 is not optional. Without it, two recruiters in the same company working two jobs both pay for the same candidate — the most common credit-dispute on platforms of this type. The existing `UNIQUE (company_id, candidate_user_id)` constraint on `candidate_unlocks` makes it free to implement.

Unused allowance expires with the job and does not transfer. Say so in the UI **at post time**, not at expiry.

## Migration
```sql
CREATE TABLE IF NOT EXISTS public.job_unlock_allowance (
  job_id uuid PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  allowance int NOT NULL DEFAULT 25,
  used int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (used >= 0 AND used <= allowance)
);
ALTER TABLE public.job_unlock_allowance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read own allowance" ON public.job_unlock_allowance FOR SELECT
  USING (public.has_company_membership(auth.uid(), company_id));

ALTER TABLE public.candidate_unlocks
  ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'allowance'
      CHECK (source IN ('allowance','wallet','admin_grant'));

CREATE TABLE IF NOT EXISTS public.db_search_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  searched_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  broadening_stage int NOT NULL DEFAULT 0,
  result_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

## RPC — `search_candidates(_job_id uuid, _filters jsonb, _limit int, _offset int)`
`SECURITY DEFINER`. Steps:
1. Verify membership and that the job is `status='active'` → else raise `job_not_active`
2. Rank candidates against the job (P0-06 relevancy, inverted)
3. Return **masked** rows. Locked rows must exclude `phone`, `email`, `resume_url`, and employer names **in the SQL SELECT list** — never by filtering in React
4. Include `is_unlocked` computed from `candidate_unlocks`
5. Insert a `db_search_events` row

Masked card shows: initials, city, experience band, skills, match score, tags. **Do not show partially masked phone numbers** like `98XXXXXX21` — it invites enumeration and looks cheap.

## RPC — `unlock_candidate(_job_id uuid, _candidate_user_id uuid)`
Extend the existing function. `SECURITY DEFINER`, single transaction:
1. Verify membership and job active
2. If a `candidate_unlocks` row already exists for `(company_id, candidate_user_id)` → return the full row, charge nothing, set `source` unchanged
3. `SELECT ... FOR UPDATE` on `job_unlock_allowance`. If `used < allowance` → increment `used`, `source='allowance'`
4. Else `SELECT ... FOR UPDATE` on the wallet. If balance ≥ `credits_per_unlock` → `apply_credit_delta()`, `source='wallet'`. Else raise `insufficient_credits`
5. Insert into `candidate_unlocks` (idempotent on the unique constraint)
6. Log to `employer_activity`
7. Return the full contact row

## UI
- Job selector pinned at the top. Without an active job, show: "Select an active job to search candidates" with a Post a Job link — never a bare "no access" message
- Remaining allowance always visible: `18 of 25 unlocks left on this job`
- Unlock confirmation states cost, source (allowance or credits), and balance after — **before** the action
- Already-unlocked candidates show `Unlocked` with no cost and open instantly
- At allowance exhaustion, explain clearly: "This job's 25 unlocks are used. Further unlocks cost 5 credits each."

## Acceptance
- [ ] Search is blocked without an active job selected
- [ ] Search is blocked on paused, expired, closed, and draft jobs
- [ ] Locked candidate responses contain no phone, email, or resume URL — verify in the browser network tab
- [ ] First unlock consumes allowance; the 26th consumes credits
- [ ] Re-unlocking the same candidate from a different job by a different recruiter costs nothing
- [ ] Two rapid unlock clicks consume exactly one allowance
- [ ] Every search writes a `db_search_events` row
