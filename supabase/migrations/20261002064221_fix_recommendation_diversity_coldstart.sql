-- ============================================================
-- recommend_jobs_for_candidate: diversity cap + cold-start ladder
-- ============================================================
-- Fixes two settings that existed in recommendation_settings but were
-- never read by the function body (max_same_company_in_top,
-- cold_start_min_applications), and adds a staged broadening ladder
-- for candidates with no resolved skills/cities (empty profile),
-- mirroring the "staged broadening, labelled, never padded" pattern
-- used elsewhere instead of silently falling back to raw freshness.

ALTER TABLE public.recommendation_settings
    ADD COLUMN IF NOT EXISTS cold_start_weight numeric NOT NULL DEFAULT 0.15;

-- Adding a new output column (recommendation_stage) changes the row type,
-- which CREATE OR REPLACE FUNCTION cannot do for RETURNS TABLE — drop first.
DROP FUNCTION IF EXISTS public.recommend_jobs_for_candidate(
    int, int, text, text, text, text, text, int, int, int, int, timestamptz, text, text, text, text, boolean, boolean
);

CREATE FUNCTION public.recommend_jobs_for_candidate(
    _limit int DEFAULT 20, _offset int DEFAULT 0, _q text DEFAULT NULL,
    _city text DEFAULT NULL, _category text DEFAULT NULL, _job_type text DEFAULT NULL,
    _work_mode text DEFAULT NULL, _min_salary int DEFAULT NULL, _max_salary int DEFAULT NULL,
    _min_exp int DEFAULT NULL, _max_exp int DEFAULT NULL, _posted_after timestamptz DEFAULT NULL,
    _education text DEFAULT NULL, _shift text DEFAULT NULL, _english_level text DEFAULT NULL,
    _company text DEFAULT NULL, _vehicle boolean DEFAULT false, _verified_only boolean DEFAULT false
) RETURNS TABLE (
    id uuid, company_id uuid, title text, city text, state text, locality text,
    min_salary integer, max_salary integer, salary_period text,
    job_type text, work_mode text, min_experience_years integer, max_experience_years integer,
    education text, skills text[], created_at timestamptz, pay_type text,
    avg_incentive_monthly integer, company_name text, company_is_verified boolean,
    boosted boolean, score numeric, score_breakdown jsonb, recommendation_stage text, total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
    _uid uuid := auth.uid();
    _prefs record;
    _cand_skill_ids uuid[];
    _cand_cities text[];
    _month_start timestamptz;
    _is_cold_start boolean;
BEGIN
    IF _uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated';
    END IF;

    SELECT * INTO _prefs FROM public.candidate_preferences cp WHERE cp.user_id = _uid;

    -- Candidate skills resolution
    IF _prefs IS NOT NULL AND COALESCE(cardinality(_prefs.skill_ids), 0) > 0 THEN
        _cand_skill_ids := _prefs.skill_ids;
    ELSE
        SELECT array_agg(DISTINCT cs.id) INTO _cand_skill_ids
        FROM public.canonical_skills cs,
             unnest(COALESCE((SELECT cp.skills FROM public.candidate_profiles cp WHERE cp.user_id = _uid), '{}'::text[])) s
        WHERE (cs.name ILIKE s OR s ILIKE ANY(cs.aliases)) AND cs.is_active;
    END IF;

    -- Candidate preferred/home cities resolution (as lowercase text array)
    IF _prefs IS NOT NULL AND COALESCE(cardinality(_prefs.city_ids), 0) > 0 THEN
        SELECT array_agg(LOWER(c.name)) INTO _cand_cities
        FROM public.cities c
        WHERE c.id = ANY(_prefs.city_ids) AND c.is_active;
    END IF;

    IF COALESCE(cardinality(_cand_cities), 0) = 0 THEN
        SELECT array_agg(LOWER(c.name)) INTO _cand_cities
        FROM public.cities c
        WHERE c.name ILIKE (SELECT p.city FROM public.profiles p WHERE p.id = _uid) AND c.is_active;
    END IF;

    IF COALESCE(cardinality(_cand_cities), 0) = 0 THEN
        SELECT ARRAY[LOWER(trim(p.city))] INTO _cand_cities
        FROM public.profiles p
        WHERE p.id = _uid AND p.city IS NOT NULL AND trim(p.city) <> '';
    END IF;

    _is_cold_start := COALESCE(cardinality(_cand_skill_ids), 0) = 0 AND COALESCE(cardinality(_cand_cities), 0) = 0;

    _month_start := date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata';

    RETURN QUERY
    WITH s AS (
        SELECT * FROM public.recommendation_settings rs WHERE rs.id = 1
    ),
    eligible_jobs AS (
        SELECT
            j.id, j.company_id, j.title, j.city, j.state, j.locality,
            j.min_salary, j.max_salary, j.salary_period,
            j.job_type::text AS job_type, j.work_mode::text AS work_mode,
            j.min_experience_years, j.max_experience_years, j.education, j.skills,
            j.created_at, j.pay_type, j.avg_incentive_monthly,
            c.name AS company_name, c.is_verified AS company_is_verified,
            j.tier, j.category,
            lb.ends_at AS boost_ends_at, lb.starts_at AS boost_starts_at,
            (j.tier = 'trending' AND j.created_at >= _month_start) AS is_trending
        FROM public.jobs j
        JOIN public.companies c ON c.id = j.company_id
        LEFT JOIN LATERAL (
            SELECT jb.ends_at, jb.starts_at FROM public.job_boosts jb
            WHERE jb.job_id = j.id AND jb.ends_at > now()
            ORDER BY jb.ends_at DESC LIMIT 1
        ) lb ON true
        WHERE j.status = 'active'
          AND (j.expires_at IS NULL OR j.expires_at > now())
          AND NOT EXISTS (
              SELECT 1 FROM public.applications a
              WHERE a.job_id = j.id AND a.candidate_id = _uid
          )
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
          -- Candidate preferences constraints (when explicitly configured)
          AND (_prefs IS NULL OR _prefs.min_salary_monthly IS NULL OR j.max_salary IS NULL OR j.max_salary >= _prefs.min_salary_monthly)
          AND (_prefs IS NULL OR _prefs.max_salary_monthly IS NULL OR j.min_salary IS NULL OR j.min_salary <= _prefs.max_salary_monthly)
          AND (_prefs IS NULL OR _prefs.min_experience_years IS NULL OR j.max_experience_years IS NULL OR j.max_experience_years >= _prefs.min_experience_years)
          AND (_prefs IS NULL OR _prefs.max_experience_years IS NULL OR j.min_experience_years IS NULL OR j.min_experience_years <= _prefs.max_experience_years)
          AND (_prefs IS NULL OR COALESCE(cardinality(_prefs.job_types), 0) = 0 OR j.job_type::text = ANY(_prefs.job_types))
          AND (_prefs IS NULL OR COALESCE(cardinality(_prefs.work_modes), 0) = 0 OR j.work_mode::text = ANY(_prefs.work_modes))
    ),
    -- Platform-wide recent application volume per job category, used only to bias
    -- the cold-start ladder ("candidates like you also applied to…") when a
    -- candidate has no skills/cities to personalize on at all.
    category_popularity AS (
        SELECT j.category, count(*) AS app_count
        FROM public.applications a
        JOIN public.jobs j ON j.id = a.job_id
        WHERE a.created_at >= now() - interval '30 days'
        GROUP BY j.category
    ),
    category_popularity_bounds AS (
        SELECT COALESCE(MAX(app_count), 0) AS max_app_count FROM category_popularity
    ),
    scored AS (
        SELECT ej.*,
            s.skill_weight, s.location_weight, s.salary_weight, s.experience_weight,
            s.freshness_weight, s.boost_weight, s.trending_weight, s.cold_start_weight,
            -- Skill score (0.0 to 1.0)
            CASE WHEN COALESCE(cardinality(ej.skills), 0) > 0 AND COALESCE(cardinality(_cand_skill_ids), 0) > 0 THEN
                (SELECT count(*)::numeric / GREATEST(cardinality(ej.skills), cardinality(_cand_skill_ids))::numeric
                 FROM unnest(ej.skills) AS job_skill
                 JOIN public.canonical_skills cs ON (cs.name ILIKE job_skill OR job_skill ILIKE ANY(cs.aliases)) AND cs.is_active
                 WHERE cs.id = ANY(_cand_skill_ids))
            ELSE 0.1 END AS skill_score,
            -- Location score (0.0 to 1.0)
            CASE WHEN COALESCE(cardinality(_cand_cities), 0) > 0 THEN
                CASE
                    WHEN LOWER(ej.city) = ANY(_cand_cities) THEN 1.0
                    WHEN ej.work_mode = 'remote' THEN 0.8
                    ELSE 0.3
                END
            ELSE 0.5 END AS location_score,
            -- Salary score (0.0 to 1.0)
            CASE WHEN _prefs IS NOT NULL AND _prefs.min_salary_monthly IS NOT NULL AND _prefs.max_salary_monthly IS NOT NULL
                 AND ej.min_salary IS NOT NULL AND ej.max_salary IS NOT NULL THEN
                GREATEST(0, 1 - ABS((ej.min_salary + ej.max_salary)/2.0 - (_prefs.min_salary_monthly + _prefs.max_salary_monthly)/2.0)
                    / GREATEST((_prefs.max_salary_monthly - _prefs.min_salary_monthly), 1)::numeric)
            ELSE 0.5 END AS salary_score,
            -- Experience score (0.0 to 1.0)
            CASE WHEN _prefs IS NOT NULL AND _prefs.min_experience_years IS NOT NULL AND _prefs.max_experience_years IS NOT NULL
                 AND ej.min_experience_years IS NOT NULL AND ej.max_experience_years IS NOT NULL THEN
                1.0 - GREATEST(0, ej.min_experience_years - _prefs.max_experience_years, _prefs.min_experience_years - ej.max_experience_years)::numeric / 10.0
            ELSE 0.5 END AS experience_score,
            -- Freshness score (0.0 to 1.0)
            GREATEST(0, 1 - EXTRACT(epoch FROM (now() - ej.created_at)) / 86400.0 / 30.0) AS freshness_score,
            -- Boost score
            CASE WHEN ej.boost_ends_at IS NOT NULL THEN
                COALESCE(s.boost_bonus_max, 0.3) * GREATEST(0, 1 - EXTRACT(epoch FROM (now() - ej.boost_starts_at)) / 3600.0 / COALESCE(s.boost_window_hours, 24))
            ELSE 0 END AS boost_score,
            -- Trending score
            CASE WHEN ej.is_trending THEN COALESCE(s.trending_bonus_max, 0.15) ELSE 0 END AS trending_score,
            -- Cold-start popularity score (0.0 to 1.0): only meaningful/used when
            -- the candidate has no skills/cities to personalize on.
            CASE WHEN _is_cold_start AND cpb.max_app_count > 0 THEN
                COALESCE(cp.app_count, 0)::numeric / cpb.max_app_count::numeric
            ELSE 0 END AS cold_start_score,
            (_is_cold_start AND COALESCE(cp.app_count, 0) >= s.cold_start_min_applications) AS category_has_signal
        FROM eligible_jobs ej
        CROSS JOIN s
        CROSS JOIN category_popularity_bounds cpb
        LEFT JOIN category_popularity cp ON cp.category = ej.category
    ),
    final_scored AS (
        SELECT s.*,
            LEAST(1, GREATEST(0,
                s.skill_score * s.skill_weight +
                s.location_score * s.location_weight +
                s.salary_score * s.salary_weight +
                s.experience_score * s.experience_weight +
                s.freshness_score * s.freshness_weight +
                s.boost_score * s.boost_weight +
                s.trending_score * s.trending_weight +
                s.cold_start_score * s.cold_start_weight
            )) AS final_score,
            jsonb_build_object(
                'skill', round(s.skill_score * 100) / 100.0,
                'location', round(s.location_score * 100) / 100.0,
                'salary', round(s.salary_score * 100) / 100.0,
                'experience', round(s.experience_score * 100) / 100.0,
                'freshness', round(s.freshness_score * 100) / 100.0,
                'boost', round(s.boost_score * 100) / 100.0,
                'trending', round(s.trending_score * 100) / 100.0,
                'cold_start', round(s.cold_start_score * 100) / 100.0,
                'weights', jsonb_build_object(
                    'skill', s.skill_weight,
                    'location', s.location_weight,
                    'salary', s.salary_weight,
                    'experience', s.experience_weight,
                    'freshness', s.freshness_weight,
                    'boost', s.boost_weight,
                    'trending', s.trending_weight,
                    'cold_start', s.cold_start_weight
                )
            ) AS score_breakdown,
            CASE
                WHEN NOT _is_cold_start THEN 'personalized'
                WHEN s.category_has_signal THEN 'popular_in_category'
                ELSE 'citywide_fresh'
            END AS recommendation_stage,
            ROW_NUMBER() OVER (PARTITION BY s.company_id ORDER BY
                s.skill_score * s.skill_weight + s.location_score * s.location_weight +
                s.salary_score * s.salary_weight + s.experience_score * s.experience_weight +
                s.freshness_score * s.freshness_weight + s.boost_score * s.boost_weight +
                s.trending_score * s.trending_weight + s.cold_start_score * s.cold_start_weight DESC
            ) AS company_rank
        FROM scored s
    )
    SELECT
        fs.id, fs.company_id, fs.title, fs.city, fs.state, fs.locality,
        fs.min_salary, fs.max_salary, fs.salary_period, fs.job_type, fs.work_mode,
        fs.min_experience_years, fs.max_experience_years, fs.education, fs.skills,
        fs.created_at, fs.pay_type, fs.avg_incentive_monthly, fs.company_name, fs.company_is_verified,
        (fs.boost_ends_at IS NOT NULL) AS boosted,
        round(fs.final_score, 4) AS score,
        fs.score_breakdown,
        fs.recommendation_stage,
        count(*) OVER() AS total_count
    FROM final_scored fs
    CROSS JOIN s
    ORDER BY
        -- Diversity cap: push rows beyond max_same_company_in_top for the same
        -- employer to the back of the result window instead of dropping them.
        (fs.company_rank > s.max_same_company_in_top) ASC,
        fs.final_score DESC,
        fs.created_at DESC
    LIMIT _limit OFFSET _offset;
END;
$$;

REVOKE ALL ON FUNCTION public.recommend_jobs_for_candidate(
    int, int, text, text, text, text, text, int, int, int, int, timestamptz, text, text, text, text, boolean, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recommend_jobs_for_candidate(
    int, int, text, text, text, text, text, int, int, int, int, timestamptz, text, text, text, text, boolean, boolean
) TO authenticated;
