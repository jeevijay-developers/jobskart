-- ============================================================
-- feed_jobs(): the public Browse feed for guests and employers (candidates already get the smarter
-- matching below via recommend_jobs_for_candidate, which every candidate sort routes through).
--
-- Problem 1 (relevance): _q matched only `title ILIKE '%_q%'`. Searching "sales" missed "Field Sales
-- Officer", "Business Development Executive" etc. public.job_matches_search() (multi-word token
-- coverage over title/category/skills + a related-terms regex) and role_category() (classify the
-- search word itself to a department) already solve exactly this for recommend_jobs_for_candidate
-- (20261010180000) — this migration gives feed_jobs() the same matching, nothing new invented.
--
-- Problem 2 (sort): feed_jobs() had no _sort param, so src/routes/jobs.tsx built a second, separate
-- Supabase query (plain .ilike()) in the client for every explicit sort (Newest/Oldest/Salary), which
-- is how the plain-ILIKE bug reached every sort, not just "Recommended". Adding _sort here lets the
-- client retire that duplicate query entirely and go through one matching implementation for every
-- sort, the same pattern recommend_jobs_for_candidate already uses.
--
-- Everything else (filters, boost/freshness/quality score, SECURITY DEFINER, REVOKE/GRANT) is
-- unchanged from the live function (20260928061220_trending_ranking_bonus.sql).
-- ============================================================

-- Adding _sort is a new argument list, not a replace: drop the old 18-arg overload explicitly so
-- callers can never land on the stale, unsorted version (the project's recurring overload gotcha --
-- see 20261008052737_drop_stale_recommend_overload.sql for the same fix on recommend_jobs_for_candidate).
DROP FUNCTION IF EXISTS public.feed_jobs(
    text, text, text, text, text, int, int, int, int, timestamptz, text, text, text, text, boolean, boolean, int, int
);

CREATE OR REPLACE FUNCTION public.feed_jobs(
    _q text DEFAULT NULL, _city text DEFAULT NULL, _category text DEFAULT NULL,
    _job_type text DEFAULT NULL, _work_mode text DEFAULT NULL,
    _min_salary int DEFAULT NULL, _max_salary int DEFAULT NULL,
    _min_exp int DEFAULT NULL, _max_exp int DEFAULT NULL, _posted_after timestamptz DEFAULT NULL,
    _education text DEFAULT NULL, _shift text DEFAULT NULL, _english_level text DEFAULT NULL,
    _company text DEFAULT NULL, _vehicle boolean DEFAULT false, _verified_only boolean DEFAULT false,
    _limit int DEFAULT 50, _offset int DEFAULT 0,
    _sort text DEFAULT 'recommended'
) RETURNS TABLE (
    id uuid, company_id uuid, title text, city text, state text, locality text,
    min_salary int, max_salary int, salary_period text, job_type text, work_mode text,
    min_experience_years int, max_experience_years int, education text, skills text[],
    created_at timestamptz, pay_type text, avg_incentive_monthly int,
    company_name text, company_is_verified boolean, boosted boolean, score numeric, total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH s AS (SELECT * FROM public.boost_settings WHERE id = 1),
  q_cat AS (SELECT CASE WHEN _q IS NOT NULL AND trim(_q) <> '' THEN public.role_category(trim(_q)) END AS v),
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
    CROSS JOIN q_cat
    LEFT JOIN LATERAL (
      SELECT jb.ends_at, jb.starts_at FROM public.job_boosts jb
      WHERE jb.job_id = j.id AND jb.ends_at > now()
      ORDER BY jb.ends_at DESC LIMIT 1
    ) lb ON true
    WHERE j.status = 'active'
      AND (j.expires_at IS NULL OR j.expires_at > now())
      -- Title match, OR job_matches_search() (multi-word token coverage over title/category/skills and
      -- the related-terms regex), OR the department the search word itself classifies to. Same OR-gate
      -- recommend_jobs_for_candidate uses (20261010180000) so Browse never does worse than the dashboard.
      AND (
          _q IS NULL OR trim(_q) = ''
          OR j.title ILIKE '%' || _q || '%'
          OR public.job_matches_search(_q, j.title, j.category, j.skills)
          OR (EXISTS (SELECT 1 FROM q_cat WHERE q_cat.v IS NOT NULL) AND j.category = (SELECT v FROM q_cat))
      )
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
  -- Exactly one of these CASE expressions is non-null for every row (the one matching _sort); the
  -- rest evaluate to NULL and so contribute no ordering, falling through to the next column.
  ORDER BY
      CASE WHEN _sort = 'recommended' OR _sort NOT IN ('newest','oldest','salary_high','salary_low') THEN score END DESC,
      CASE WHEN _sort = 'newest' THEN created_at END DESC,
      CASE WHEN _sort = 'oldest' THEN created_at END ASC,
      CASE WHEN _sort = 'salary_high' THEN max_salary END DESC NULLS LAST,
      CASE WHEN _sort = 'salary_low' THEN min_salary END ASC NULLS LAST,
      created_at DESC, id
  LIMIT _limit OFFSET _offset;
$$;

REVOKE ALL ON FUNCTION public.feed_jobs(text, text, text, text, text, int, int, int, int, timestamptz, text, text, text, text, boolean, boolean, int, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.feed_jobs(text, text, text, text, text, int, int, int, int, timestamptz, text, text, text, text, boolean, boolean, int, int, text) TO authenticated, anon;
