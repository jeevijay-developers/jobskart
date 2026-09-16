# JobsKart — Database Schema

Postgres 15 (Supabase). 47 tables live. RLS on every user-facing table.
This document = current inventory + **all P0 DDL**.

---

## 1. Current inventory

**Identity & profiles**
`profiles`, `platform_roles`, `candidate_profiles`, `candidate_education`, `candidate_experiences`, `candidate_languages`, `candidate_documents`, `candidate_job_alerts`, `candidate_nudges`

**Employer**
`companies`, `employer_members`, `employer_invites`, `company_documents`, `company_verifications`, `employer_activity`

**Jobs & applications**
`jobs`, `applications`, `application_notes`, `application_status_history`, `application_match_scores`, `application_ai_scores`, `saved_jobs`, `job_reports`, `interviews`

**Money**
`plans`, `plan_settings`, `credit_packs`, `credit_transactions`, `employer_credit_wallets`, `razorpay_orders`, `invoices`, `invoice_counters`, `candidate_unlocks`, `download_events`, `download_ledger`, `whatsapp_send_ledger`

**Masters**
`cities`, `industries`, `job_categories`, `job_titles_master`, `skills_master`, `languages_master`, `candidate_assets_master`, `match_scoring_config`, `learning_resources`, `promo_banners`, `notifications`, `contact_messages`, `admin_seed`

**Enums**
`user_type`, `experience_status`, `employer_role`, `app_platform_role`, `company_type`, `company_size`, `job_type`, `job_shift`, `job_status`, `work_mode`, `application_status`, `interview_mode`, `interview_status`, `credit_txn_kind`, `kyc_method`, `kyc_status`

> Note: `job_type` = employment type (`full_time`, `part_time`, …). It is **not** the commercial tier. Tier is added below as `job_tier`.

---

## 2. P0 DDL

### 2.1 Job tiers

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

CREATE INDEX IF NOT EXISTS jobs_tier_status_idx ON public.jobs (tier, status)
  WHERE status = 'active';
```

Plan entitlements ride in the existing `plans.limits` jsonb:

```jsonc
{
  "live_jobs_max": 5,
  "classic_posts_per_month": 10,
  "classic_plus_enabled": true,
  "trending_posts_per_month": 2,
  "unlocks_per_job": 25,
  "boost_credits_per_month": 4,
  "repost_allowed": true,
  "response_retention_days": 60
}
```

### 2.2 Boost engine

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

CREATE INDEX IF NOT EXISTS job_boosts_active_idx
  ON public.job_boosts (job_id, ends_at DESC);

-- one boost per job per calendar day (IST)
CREATE UNIQUE INDEX IF NOT EXISTS job_boosts_one_per_day
  ON public.job_boosts (job_id, ((starts_at AT TIME ZONE 'Asia/Kolkata')::date));

ALTER TABLE public.job_boosts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read own boosts" ON public.job_boosts FOR SELECT
  USING (public.has_company_membership(auth.uid(), company_id));
```

`jobs.boosted_until` is kept as a **denormalised cache** of `max(ends_at)` for cheap ranking, maintained by trigger. Never written directly by app code.

### 2.3 Job-scoped unlock allowance

Resolves the conflict between the deck (25 per job) and the built model (company-wide credits).

```sql
CREATE TABLE IF NOT EXISTS public.job_unlock_allowance (
  job_id uuid PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  allowance int NOT NULL DEFAULT 25,
  used int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (used >= 0 AND used <= allowance)
);

ALTER TABLE public.candidate_unlocks
  ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'allowance'
      CHECK (source IN ('allowance','wallet','admin_grant'));
```

`candidate_unlocks` keeps `UNIQUE (company_id, candidate_user_id)`. Semantics:

- Unlock consumes the **job's allowance** first, then the company wallet at `plan_settings.credits_per_unlock`.
- If the company already unlocked that candidate (any job, any recruiter), the unlock is **free and instant** — no allowance, no credits. The unique constraint makes this automatic.
- Allowance does not transfer between jobs and expires with the job.

### 2.4 DB search gating + search audit

```sql
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
CREATE INDEX IF NOT EXISTS db_search_company_idx
  ON public.db_search_events (company_id, created_at DESC);
```

### 2.5 Response retention (60-day purge)

```sql
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS responses_purge_at timestamptz,
  ADD COLUMN IF NOT EXISTS purge_notice_sent_at timestamptz;

-- set on expiry/close: responses_purge_at = expires_at + interval '60 days'
```

Purge **revokes employer visibility**; it does not delete the candidate's application history. Candidates keep their own record. Implement as a nightly job flipping `applications.employer_visible = false`:

```sql
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS employer_visible boolean NOT NULL DEFAULT true;
```

RLS on `applications` for employers gains `AND employer_visible`.

### 2.6 Employer verification

```sql
ALTER TABLE public.company_verifications
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_ref text,
  ADD COLUMN IF NOT EXISTS raw_response jsonb,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0;
```

`raw_response` holds the API payload for dispute resolution. RLS: readable only by `super_admin` of that company + platform admin.

### 2.7 JD library (deterministic generation)

```sql
CREATE TABLE IF NOT EXISTS public.jd_role_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_title text NOT NULL,
  industry text,
  summary_line_1 text NOT NULL,
  summary_line_2 text NOT NULL,
  fixed_responsibilities text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  UNIQUE (job_title, industry)
);

CREATE TABLE IF NOT EXISTS public.jd_skill_responsibilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill text NOT NULL,
  job_title text,
  industry text,
  responsibility text NOT NULL,
  sort int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS jd_skill_resp_lookup
  ON public.jd_skill_responsibilities (lower(skill), job_title, industry);
```

Seeded from `Final_JD_Format_with_Sample.xlsx`. Admin-editable at `/admin/masters`.

### 2.8 Ranking config

Reuse the existing `match_scoring_config` table. Expected keys:

```jsonc
{
  "w_skills": 60, "w_location": 20, "w_experience": 15, "w_salary": 5,
  "tier_bonus": { "classic": 0, "classic_plus": 5, "trending": 25 },
  "boost_bonus_max": 30, "boost_window_hours": 24,
  "freshness_bonus_max": 20, "freshness_halflife_days": 7
}
```

---

## 3. Posting-flow columns already present

Confirmed on `jobs`: `industry`, `pay_type` (`fixed`/`fixed_incentive`/`incentive_only`), `avg_incentive_monthly`, `interview_type` (`in_person`/`telephonic`), `experience_bucket` (`any`/`fresher`/`experienced`), `hiring_for_company`, `pan_india_ok`, `auto_shortlist_threshold`, `responses_locked_after`, `gender_pref`, `english_level`, `age_min`/`age_max`, `skills[]`, `perks[]`.

The posting-flow document is therefore **mostly a UI reorder**, not a schema change. Remaining additions:

```sql
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS annual_ctc_min integer,
  ADD COLUMN IF NOT EXISTS annual_ctc_max integer,
  ADD COLUMN IF NOT EXISTS joining_fee_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS joining_fee_amount integer,
  ADD COLUMN IF NOT EXISTS interview_same_as_company boolean,
  ADD COLUMN IF NOT EXISTS interview_city text,
  ADD COLUMN IF NOT EXISTS interview_locality text,
  ADD COLUMN IF NOT EXISTS interview_address text,
  ADD COLUMN IF NOT EXISTS custom_perks text[] NOT NULL DEFAULT '{}';
```

Annual CTC is **derived** (`monthly × 12`) and stored for filtering only. Recruiters enter monthly.

---

## 4. Indexing for launch

```sql
CREATE INDEX IF NOT EXISTS jobs_feed_idx
  ON public.jobs (status, city, created_at DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS jobs_skills_gin ON public.jobs USING gin (skills);
CREATE INDEX IF NOT EXISTS cand_skills_gin ON public.candidate_profiles USING gin (skills);
CREATE INDEX IF NOT EXISTS applications_job_idx
  ON public.applications (job_id, created_at DESC) WHERE employer_visible;
```

GIN on `skills[]` is what makes the overlap scoring fast enough to run in Postgres instead of the browser.
