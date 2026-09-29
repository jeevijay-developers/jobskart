-- Trending tier ranking bonus (see employer-monetization-detailed-implementation-plan.md
-- Phase 0, Task 0.3 — Option A).
--
-- Bug: feed_jobs() / feed_jobs_for_candidate() computed
-- score = boost_bonus + freshness_bonus + quality_bonus with no term for
-- jobs.tier = 'trending' — Trending was purchasable via activate_job_with_tier()
-- but had zero ranking effect, unlike what prompt structure/monetization.md
-- promises ("elevated ranking + premium placement").
--
-- trending_bonus does not decay like boost_bonus: Trending is a purchased
-- tier for the job's whole 30-day life, not a day-scoped add-on, so it's a
-- flat bonus for as long as jobs.tier = 'trending'.
--
-- Reuses the existing boost_settings singleton (already holds
-- boost_weight/freshness_weight/quality_weight — general ranking tunables
-- despite the table's name) rather than creating a new settings table.

ALTER TABLE public.boost_settings
  ADD COLUMN IF NOT EXISTS trending_weight numeric NOT NULL DEFAULT 30;

-- feed_jobs() — public feed, unchanged signature/columns, copied verbatim
-- from 20260924113852_job_expiry_renewal.sql plus the trending_bonus term.
CREATE OR REPLACE FUNCTION public.feed_jobs(
  _q text DEFAULT NULL,
  _city text DEFAULT NULL,
  _category text DEFAULT NULL,
  _job_type text DEFAULT NULL,
  _work_mode text DEFAULT NULL,
  _min_salary int DEFAULT NULL,
  _max_salary int DEFAULT NULL,
  _min_exp int DEFAULT NULL,
  _max_exp int DEFAULT NULL,
  _posted_after timestamptz DEFAULT NULL,
  _education text DEFAULT NULL,
  _shift text DEFAULT NULL,
  _english_level text DEFAULT NULL,
  _company text DEFAULT NULL,
  _vehicle boolean DEFAULT false,
  _verified_only boolean DEFAULT false,
  _limit int DEFAULT 50,
  _offset int DEFAULT 0
) RETURNS TABLE (
  id uuid,
  company_id uuid,
  title text,
  city text,
  state text,
  locality text,
  min_salary integer,
  max_salary integer,
  salary_period text,
  job_type text,
  work_mode text,
  min_experience_years integer,
  max_experience_years integer,
  education text,
  skills text[],
  created_at timestamptz,
  pay_type text,
  avg_incentive_monthly integer,
  company_name text,
  company_is_verified boolean,
  boosted boolean,
  score numeric,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH s AS (SELECT * FROM public.boost_settings WHERE id = 1),
  scored AS (
    SELECT
      j.id, j.company_id, j.title, j.city, j.state, j.locality,
      j.min_salary, j.max_salary, j.salary_period, j.job_type, j.work_mode,
      j.min_experience_years, j.max_experience_years, j.education, j.skills,
      j.created_at, j.pay_type, j.avg_incentive_monthly,
      c.name AS company_name, c.is_verified AS company_is_verified,
      lb.ends_at AS boost_ends_at,
      (
        CASE WHEN lb.ends_at IS NOT NULL AND lb.ends_at > now()
          THEN s.boost_weight * (
            extract(epoch FROM (lb.ends_at - now()))
            / GREATEST(extract(epoch FROM (lb.ends_at - lb.starts_at)), 1)
          )
          ELSE 0 END
        + s.freshness_weight * GREATEST(0, 1 - (extract(epoch FROM (now() - j.created_at)) / 86400.0) / 7)
        + s.quality_weight * (COALESCE(j.quality_score, 0) / 100.0)
        + s.trending_weight * (CASE WHEN j.tier = 'trending' THEN 1 ELSE 0 END)
      ) AS score
    FROM public.jobs j
    JOIN public.companies c ON c.id = j.company_id
    CROSS JOIN s
    LEFT JOIN LATERAL (
      SELECT jb.ends_at, jb.starts_at FROM public.job_boosts jb
      WHERE jb.job_id = j.id AND jb.ends_at > now()
      ORDER BY jb.ends_at DESC LIMIT 1
    ) lb ON true
    WHERE j.status = 'active'
      AND (j.expires_at IS NULL OR j.expires_at > now())
      AND (_q IS NULL OR j.title ILIKE '%' || _q || '%')
      AND (_city IS NULL OR j.city ILIKE '%' || _city || '%')
      AND (_category IS NULL OR j.category = _category)
      AND (_job_type IS NULL OR j.job_type::text = _job_type)
      AND (_work_mode IS NULL OR j.work_mode::text = _work_mode)
      AND (_min_salary IS NULL OR j.min_salary >= _min_salary)
      AND (_max_salary IS NULL OR j.max_salary <= _max_salary)
      AND (_max_exp IS NULL OR j.min_experience_years <= _max_exp)
      AND (_min_exp IS NULL OR j.max_experience_years >= _min_exp OR j.max_experience_years IS NULL)
      AND (_posted_after IS NULL OR j.created_at >= _posted_after)
      AND (_education IS NULL OR j.education = _education)
      AND (_shift IS NULL OR j.shift::text = _shift)
      AND (_english_level IS NULL OR j.english_level = _english_level)
      AND (_company IS NULL OR c.name ILIKE '%' || _company || '%')
      AND (_vehicle IS NOT TRUE OR j.required_assets @> ARRAY['Two-wheeler'])
      AND (_verified_only IS NOT TRUE OR c.is_verified = true)
  )
  SELECT
    id, company_id, title, city, state, locality, min_salary, max_salary, salary_period,
    job_type, work_mode, min_experience_years, max_experience_years, education, skills,
    created_at, pay_type, avg_incentive_monthly, company_name, company_is_verified,
    (boost_ends_at IS NOT NULL) AS boosted,
    score,
    count(*) OVER() AS total_count
  FROM scored
  ORDER BY score DESC, created_at DESC
  LIMIT _limit OFFSET _offset;
$$;

-- feed_jobs_for_candidate() — candidate-scoped feed (excludes applied jobs),
-- copied verbatim from 20260926071831_feed_jobs_for_candidate.sql plus the
-- same trending_bonus term.
CREATE OR REPLACE FUNCTION public.feed_jobs_for_candidate(
  _q text DEFAULT NULL,
  _city text DEFAULT NULL,
  _category text DEFAULT NULL,
  _job_type text DEFAULT NULL,
  _work_mode text DEFAULT NULL,
  _min_salary int DEFAULT NULL,
  _max_salary int DEFAULT NULL,
  _min_exp int DEFAULT NULL,
  _max_exp int DEFAULT NULL,
  _posted_after timestamptz DEFAULT NULL,
  _education text DEFAULT NULL,
  _shift text DEFAULT NULL,
  _english_level text DEFAULT NULL,
  _company text DEFAULT NULL,
  _vehicle boolean DEFAULT false,
  _verified_only boolean DEFAULT false,
  _sort text DEFAULT 'recommended',
  _limit int DEFAULT 50,
  _offset int DEFAULT 0
) RETURNS TABLE (
  id uuid,
  company_id uuid,
  title text,
  city text,
  state text,
  locality text,
  min_salary integer,
  max_salary integer,
  salary_period text,
  job_type text,
  work_mode text,
  min_experience_years integer,
  max_experience_years integer,
  education text,
  skills text[],
  created_at timestamptz,
  pay_type text,
  avg_incentive_monthly integer,
  company_name text,
  company_is_verified boolean,
  boosted boolean,
  score numeric,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  RETURN QUERY
  WITH s AS (SELECT * FROM public.boost_settings WHERE id = 1),
  scored AS (
    SELECT
      j.id, j.company_id, j.title, j.city, j.state, j.locality,
      j.min_salary, j.max_salary, j.salary_period, j.job_type, j.work_mode,
      j.min_experience_years, j.max_experience_years, j.education, j.skills,
      j.created_at, j.pay_type, j.avg_incentive_monthly,
      c.name AS company_name, c.is_verified AS company_is_verified,
      lb.ends_at AS boost_ends_at,
      (
        CASE WHEN lb.ends_at IS NOT NULL AND lb.ends_at > now()
          THEN s.boost_weight * (
            extract(epoch FROM (lb.ends_at - now()))
            / GREATEST(extract(epoch FROM (lb.ends_at - lb.starts_at)), 1)
          )
          ELSE 0 END
        + s.freshness_weight * GREATEST(0, 1 - (extract(epoch FROM (now() - j.created_at)) / 86400.0) / 7)
        + s.quality_weight * (COALESCE(j.quality_score, 0) / 100.0)
        + s.trending_weight * (CASE WHEN j.tier = 'trending' THEN 1 ELSE 0 END)
      ) AS job_score
    FROM public.jobs j
    JOIN public.companies c ON c.id = j.company_id
    CROSS JOIN s
    LEFT JOIN LATERAL (
      SELECT jb.ends_at, jb.starts_at FROM public.job_boosts jb
      WHERE jb.job_id = j.id AND jb.ends_at > now()
      ORDER BY jb.ends_at DESC LIMIT 1
    ) lb ON true
    WHERE j.status = 'active'
      AND (j.expires_at IS NULL OR j.expires_at > now())
      AND (_q IS NULL OR j.title ILIKE '%' || _q || '%')
      AND (_city IS NULL OR j.city ILIKE '%' || _city || '%')
      AND (_category IS NULL OR j.category = _category)
      AND (_job_type IS NULL OR j.job_type::text = _job_type)
      AND (_work_mode IS NULL OR j.work_mode::text = _work_mode)
      AND (_min_salary IS NULL OR j.min_salary >= _min_salary)
      AND (_max_salary IS NULL OR j.max_salary <= _max_salary)
      AND (_max_exp IS NULL OR j.min_experience_years <= _max_exp)
      AND (_min_exp IS NULL OR j.max_experience_years >= _min_exp OR j.max_experience_years IS NULL)
      AND (_posted_after IS NULL OR j.created_at >= _posted_after)
      AND (_education IS NULL OR j.education = _education)
      AND (_shift IS NULL OR j.shift::text = _shift)
      AND (_english_level IS NULL OR j.english_level = _english_level)
      AND (_company IS NULL OR c.name ILIKE '%' || _company || '%')
      AND (_vehicle IS NOT TRUE OR j.required_assets @> ARRAY['Two-wheeler'])
      AND (_verified_only IS NOT TRUE OR c.is_verified = true)
      AND NOT EXISTS (
        SELECT 1 FROM public.applications a
        WHERE a.job_id = j.id AND a.candidate_id = _uid
      )
  )
  SELECT
    scored.id, scored.company_id, scored.title, scored.city, scored.state, scored.locality,
    scored.min_salary, scored.max_salary, scored.salary_period,
    scored.job_type, scored.work_mode, scored.min_experience_years, scored.max_experience_years,
    scored.education, scored.skills, scored.created_at, scored.pay_type, scored.avg_incentive_monthly,
    scored.company_name, scored.company_is_verified,
    (scored.boost_ends_at IS NOT NULL) AS boosted,
    scored.job_score AS score,
    count(*) OVER() AS total_count
  FROM scored
  ORDER BY
    CASE WHEN _sort = 'newest' THEN scored.created_at END DESC,
    CASE WHEN _sort = 'oldest' THEN scored.created_at END ASC,
    CASE WHEN _sort = 'salary_high' THEN scored.max_salary END DESC NULLS LAST,
    CASE WHEN _sort = 'salary_low' THEN scored.min_salary END ASC NULLS LAST,
    CASE WHEN _sort NOT IN ('newest', 'oldest', 'salary_high', 'salary_low') THEN scored.job_score END DESC,
    scored.created_at DESC
  LIMIT _limit OFFSET _offset;
END;
$$;
