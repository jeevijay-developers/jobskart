-- ============================================================
-- Department-aware recommendations + department-aware Browse search.
--
-- Base: 20261008100000_recommendations_keep_applied_jobs.sql (same signature,
-- same return columns, same REVOKE/GRANT, same sort/pagination/scoring/boost
-- logic, same "applied jobs stay in Recommendations, hidden in Browse"
-- behaviour from that migration — untouched). CREATE OR REPLACE swaps the
-- body in place; no overload is created.
--
-- Requirement 7 (Recommendations): in recommended mode (_relevant_only IS
-- TRUE), when the candidate has department signal (_cand_categories is
-- non-empty), a job whose department (jobs.category) is neither the
-- candidate's own department nor a role_adjacent_categories() neighbour must
-- not appear — even if it would otherwise pass via skill or semantic
-- threshold. The one exception is a clear title-word match (same _role_words
-- check role_score already uses). This is a NEW, additional gate
-- (department_ok), layered on top of the existing relevant_skill/role/
-- semantic_threshold OR-gate with AND, not a replacement for it. When the
-- candidate has no department signal at all (cold start / no known
-- categories) or the job itself has no category, behaviour is unchanged.
-- This logic is generic over every category value in jobs.category /
-- role_category() — no department name is hardcoded.
--
-- Requirement 8 (Browse search): _q already matches job titles
-- (ILIKE '%_q%'). Added: if _q classifies to a department via the existing
-- public.role_category() function (the same function used for candidates'
-- own roles — jobs.category already uses this exact vocabulary, confirmed
-- against role_category()'s own comment and live data), also include jobs
-- whose category equals that department. If _q does not map to any
-- department, behaviour is exactly as before (title-only). This condition
-- lives in the same eligible_jobs WHERE clause used by both Browse
-- (_relevant_only = false) and Recommendations (_relevant_only = true), so it
-- also benefits a candidate's in-recommendations search, with no separate
-- code path.
-- ============================================================

CREATE OR REPLACE FUNCTION public.recommend_jobs_for_candidate(
    _limit int DEFAULT 20, _offset int DEFAULT 0, _q text DEFAULT NULL,
    _city text DEFAULT NULL, _category text DEFAULT NULL, _job_type text DEFAULT NULL,
    _work_mode text DEFAULT NULL, _min_salary int DEFAULT NULL, _max_salary int DEFAULT NULL,
    _min_exp int DEFAULT NULL, _max_exp int DEFAULT NULL, _posted_after timestamptz DEFAULT NULL,
    _education text DEFAULT NULL, _shift text DEFAULT NULL, _english_level text DEFAULT NULL,
    _company text DEFAULT NULL, _vehicle boolean DEFAULT false, _verified_only boolean DEFAULT false,
    _relevant_only boolean DEFAULT false,
    _sort text DEFAULT 'recommended'
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
    _cand_skill_text text[];
    _cand_cities text[];
    _role_words text[];
    _cand_categories text[];
    _cand_adjacent text[];
    _cand_embedding vector(1536);
    _cand_years int;
    _exp_salary numeric;
    _month_start timestamptz;
    _is_cold_start boolean;
    -- Requirement 8: the department _q itself classifies to, if any (NULL
    -- when _q is NULL/blank or doesn't map to a known department).
    _q_category text;
BEGIN
    IF _uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated';
    END IF;

    -- Defense-in-depth: an unrecognised sort value falls back to the default
    -- relevance ranking instead of silently matching no ORDER BY branch below.
    IF _sort NOT IN ('recommended', 'newest', 'oldest', 'salary_high', 'salary_low') THEN
        _sort := 'recommended';
    END IF;

    IF _q IS NOT NULL AND trim(_q) <> '' THEN
        _q_category := public.role_category(trim(_q));
    END IF;

    SELECT * INTO _prefs FROM public.candidate_preferences cp WHERE cp.user_id = _uid;

    -- Role signals: last role, headline and interested roles (onboarding).
    SELECT cp.profile_embedding, cp.years_experience, cp.expected_salary,
           COALESCE((SELECT array_agg(DISTINCT lower(trim(s))) FROM unnest(COALESCE(cp.skills, '{}'::text[])) s WHERE trim(s) <> ''), '{}'::text[]),
           (SELECT array_agg(DISTINCT w) FROM unnest(regexp_split_to_array(lower(COALESCE(cp.last_role, '') || ' ' || COALESCE(cp.headline, '') || ' ' || array_to_string(COALESCE(cp.interested_roles, '{}'::text[]), ' ')), '[^a-z0-9+#.]+')) w
             WHERE length(w) >= 3 AND w <> ALL (ARRAY['and', 'the', 'for', 'with']))
    INTO _cand_embedding, _cand_years, _exp_salary, _cand_skill_text, _role_words
    FROM public.candidate_profiles cp WHERE cp.user_id = _uid;

    -- Departments the candidate's roles map to, plus neighbouring departments.
    SELECT COALESCE(array_agg(DISTINCT public.role_category(r)) FILTER (WHERE public.role_category(r) IS NOT NULL), '{}'::text[])
    INTO _cand_categories
    FROM public.candidate_profiles cp,
         unnest(ARRAY[cp.last_role, cp.headline] || COALESCE(cp.interested_roles, '{}'::text[])) r
    WHERE cp.user_id = _uid;

    SELECT COALESCE(array_agg(DISTINCT x), '{}'::text[]) INTO _cand_adjacent
    FROM unnest(COALESCE(_cand_categories, '{}'::text[])) c,
         unnest(public.role_adjacent_categories(c)) x
    WHERE x <> ALL (COALESCE(_cand_categories, '{}'::text[]));

    -- Candidate skills: explicit preferences first, else derive from profile text
    IF _prefs IS NOT NULL AND COALESCE(cardinality(_prefs.skill_ids), 0) > 0 THEN
        _cand_skill_ids := _prefs.skill_ids;
    ELSE
        SELECT array_agg(DISTINCT cs.id) INTO _cand_skill_ids
        FROM public.canonical_skills cs,
             unnest(COALESCE(_cand_skill_text, '{}'::text[])) s
        WHERE (cs.name ILIKE s OR s ILIKE ANY(cs.aliases)) AND cs.is_active;
    END IF;

    -- Candidate cities: preference city ids, profile city, and preferred_cities
    IF _prefs IS NOT NULL AND COALESCE(cardinality(_prefs.city_ids), 0) > 0 THEN
        SELECT array_agg(LOWER(c.name)) INTO _cand_cities
        FROM public.cities c
        WHERE c.id = ANY(_prefs.city_ids) AND c.is_active;
    END IF;

    SELECT array_agg(DISTINCT x) INTO _cand_cities
    FROM unnest(
        COALESCE(_cand_cities, '{}'::text[])
        || COALESCE((SELECT ARRAY[LOWER(trim(p.city))] FROM public.profiles p WHERE p.id = _uid AND p.city IS NOT NULL AND trim(p.city) <> ''), '{}'::text[])
        || COALESCE((SELECT array_agg(LOWER(trim(pc))) FROM public.candidate_profiles cp2, unnest(COALESCE(cp2.preferred_cities, '{}'::text[])) pc WHERE cp2.user_id = _uid AND trim(pc) <> ''), '{}'::text[])
    ) x;

    -- Cold start only when there is genuinely no signal at all. A candidate
    -- who gave any role (last role, headline, interested roles) is never cold
    -- start, so the relevance gate below always applies to them.
    _is_cold_start := COALESCE(cardinality(_cand_skill_ids), 0) = 0
                      AND COALESCE(cardinality(_cand_skill_text), 0) = 0
                      AND COALESCE(cardinality(_cand_cities), 0) = 0
                      AND COALESCE(cardinality(_role_words), 0) = 0
                      AND COALESCE(cardinality(_cand_categories), 0) = 0;

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
            j.tier, j.category, j.description_embedding,
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
          -- Recommendations keep jobs the candidate already applied to (client
          -- requirement); Browse jobs (_relevant_only = false) still hides them.
          AND (
              _relevant_only IS TRUE
              OR NOT EXISTS (
                  SELECT 1 FROM public.applications a
                  WHERE a.job_id = j.id AND a.candidate_id = _uid
              )
          )
          -- Requirement 8: title match OR (the search word maps to a known
          -- department AND the job's own category is that department).
          AND (
              _q IS NULL
              OR j.title ILIKE '%' || _q || '%'
              OR (_q_category IS NOT NULL AND j.category = _q_category)
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
          AND (_prefs IS NULL OR _prefs.min_salary_monthly IS NULL OR j.max_salary IS NULL OR j.max_salary >= _prefs.min_salary_monthly)
          AND (_prefs IS NULL OR _prefs.max_salary_monthly IS NULL OR j.min_salary IS NULL OR j.min_salary <= _prefs.max_salary_monthly)
          AND (_prefs IS NULL OR _prefs.min_experience_years IS NULL OR j.max_experience_years IS NULL OR j.max_experience_years >= _prefs.min_experience_years)
          AND (_prefs IS NULL OR _prefs.max_experience_years IS NULL OR j.min_experience_years IS NULL OR j.min_experience_years <= _prefs.max_experience_years)
          AND (_prefs IS NULL OR COALESCE(cardinality(_prefs.job_types), 0) = 0 OR j.job_type::text = ANY(_prefs.job_types))
          AND (_prefs IS NULL OR COALESCE(cardinality(_prefs.work_modes), 0) = 0 OR j.work_mode::text = ANY(_prefs.work_modes))
    ),
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
            s.skill_weight, s.role_weight, s.location_weight, s.salary_weight, s.experience_weight,
            s.freshness_weight, s.boost_weight, s.trending_weight, s.cold_start_weight, s.semantic_weight,
            -- Skill coverage of the JOB's required skills (0..1); neutral when the job lists none
            CASE WHEN COALESCE(cardinality(ej.skills), 0) = 0 THEN 0.3
                 WHEN COALESCE(cardinality(_cand_skill_ids), 0) = 0 AND COALESCE(cardinality(_cand_skill_text), 0) = 0 THEN 0.1
            ELSE (
                SELECT (count(*) FILTER (WHERE
                            lower(trim(js)) = ANY(COALESCE(_cand_skill_text, '{}'::text[]))
                            OR EXISTS (
                                SELECT 1 FROM public.canonical_skills cs
                                WHERE cs.is_active AND cs.id = ANY(COALESCE(_cand_skill_ids, '{}'::uuid[]))
                                  AND (cs.name ILIKE js OR js ILIKE ANY(cs.aliases))
                            )
                       ))::numeric / cardinality(ej.skills)::numeric
                FROM unnest(ej.skills) AS js
            ) END::numeric AS skill_score,
            -- Role fit: department first (exact 1.0, neighbouring 0.75), then title words
            CASE WHEN ej.category IS NOT NULL AND ej.category = ANY(COALESCE(_cand_categories, '{}'::text[])) THEN 1.0
                 WHEN ej.category IS NOT NULL AND ej.category = ANY(COALESCE(_cand_adjacent, '{}'::text[])) THEN 0.75
                 WHEN COALESCE(cardinality(_role_words), 0) = 0 THEN 0.5
                 WHEN EXISTS (SELECT 1 FROM unnest(_role_words) rw
                              WHERE rw = ANY(regexp_split_to_array(lower(ej.title), '[^a-z0-9+#.]+'))) THEN 1.0
                 WHEN EXISTS (SELECT 1 FROM unnest(COALESCE(_cand_skill_text, '{}'::text[])) sk
                              WHERE length(sk) >= 3 AND lower(ej.title) LIKE '%' || sk || '%') THEN 0.7
                 ELSE 0.0 END::numeric AS role_score,
            -- Requirement 7: hard department gate (additional to the existing
            -- relevance OR-gate below, not a replacement for it). True when
            -- there is no department signal to judge by (unchanged cold-start
            -- behaviour), the job has no category, the job's department is the
            -- candidate's own or a neighbour, or the job title clearly matches
            -- one of the candidate's role words (the same exception role_score
            -- already grants a 1.0 for).
            (
                COALESCE(cardinality(_cand_categories), 0) = 0
                OR ej.category IS NULL
                OR ej.category = ANY(COALESCE(_cand_categories, '{}'::text[]))
                OR ej.category = ANY(COALESCE(_cand_adjacent, '{}'::text[]))
                OR EXISTS (SELECT 1 FROM unnest(_role_words) rw
                           WHERE rw = ANY(regexp_split_to_array(lower(ej.title), '[^a-z0-9+#.]+')))
            ) AS department_ok,
            CASE WHEN COALESCE(cardinality(_cand_cities), 0) > 0 THEN
                CASE
                    WHEN LOWER(ej.city) = ANY(_cand_cities) THEN 1.0
                    WHEN ej.work_mode = 'remote' THEN 0.8
                    ELSE 0.3
                END
            ELSE 0.5 END::numeric AS location_score,
            CASE
                WHEN _prefs IS NOT NULL AND _prefs.min_salary_monthly IS NOT NULL AND _prefs.max_salary_monthly IS NOT NULL
                     AND ej.min_salary IS NOT NULL AND ej.max_salary IS NOT NULL THEN
                    GREATEST(0, 1 - ABS((ej.min_salary + ej.max_salary)/2.0 - (_prefs.min_salary_monthly + _prefs.max_salary_monthly)/2.0)
                        / GREATEST((_prefs.max_salary_monthly - _prefs.min_salary_monthly), 1)::numeric)
                WHEN COALESCE(_exp_salary, 0) > 0 AND COALESCE(ej.max_salary, ej.min_salary) IS NOT NULL THEN
                    LEAST(1, COALESCE(ej.max_salary, ej.min_salary)::numeric / _exp_salary)
                ELSE 0.5 END::numeric AS salary_score,
            CASE
                WHEN _prefs IS NOT NULL AND _prefs.min_experience_years IS NOT NULL AND _prefs.max_experience_years IS NOT NULL
                     AND ej.min_experience_years IS NOT NULL AND ej.max_experience_years IS NOT NULL THEN
                    1.0 - GREATEST(0, ej.min_experience_years - _prefs.max_experience_years, _prefs.min_experience_years - ej.max_experience_years)::numeric / 10.0
                WHEN _cand_years IS NOT NULL AND (ej.min_experience_years IS NOT NULL OR ej.max_experience_years IS NOT NULL) THEN
                    GREATEST(0, 1 - GREATEST(0, COALESCE(ej.min_experience_years, 0) - _cand_years,
                                                _cand_years - COALESCE(ej.max_experience_years, _cand_years))::numeric / 5.0)
                ELSE 0.5 END::numeric AS experience_score,
            GREATEST(0, 1 - EXTRACT(epoch FROM (now() - ej.created_at)) / 86400.0 / 30.0)::numeric AS freshness_score,
            CASE WHEN ej.boost_ends_at IS NOT NULL THEN
                COALESCE(s.boost_bonus_max, 0.3) * GREATEST(0, 1 - EXTRACT(epoch FROM (now() - ej.boost_starts_at)) / 3600.0 / COALESCE(s.boost_window_hours, 24))::numeric
            ELSE 0 END::numeric AS boost_score,
            CASE WHEN ej.is_trending THEN COALESCE(s.trending_bonus_max, 0.15) ELSE 0 END::numeric AS trending_score,
            CASE WHEN _is_cold_start AND cpb.max_app_count > 0 THEN
                COALESCE(cp.app_count, 0)::numeric / cpb.max_app_count::numeric
            ELSE 0 END::numeric AS cold_start_score,
            (_is_cold_start AND COALESCE(cp.app_count, 0) >= s.cold_start_min_applications) AS category_has_signal,
            CASE WHEN _cand_embedding IS NOT NULL AND ej.description_embedding IS NOT NULL THEN
                GREATEST(0, LEAST(1, (1 - (ej.description_embedding <=> _cand_embedding))::numeric))
            ELSE 0.5 END::numeric AS semantic_score
        FROM eligible_jobs ej
        CROSS JOIN s
        CROSS JOIN category_popularity_bounds cpb
        LEFT JOIN category_popularity cp ON cp.category = ej.category
    ),
    final_scored AS (
        SELECT s.*,
            LEAST(1, GREATEST(0,
                s.skill_score * s.skill_weight + s.role_score * s.role_weight +
                s.location_score * s.location_weight + s.salary_score * s.salary_weight +
                s.experience_score * s.experience_weight + s.freshness_score * s.freshness_weight +
                s.boost_score * s.boost_weight + s.trending_score * s.trending_weight +
                s.cold_start_score * s.cold_start_weight + s.semantic_score * s.semantic_weight
            )) AS final_score,
            jsonb_build_object(
                'skill', round(s.skill_score * 100) / 100.0,
                'role', round(s.role_score * 100) / 100.0,
                'location', round(s.location_score * 100) / 100.0,
                'salary', round(s.salary_score * 100) / 100.0,
                'experience', round(s.experience_score * 100) / 100.0,
                'freshness', round(s.freshness_score * 100) / 100.0,
                'boost', round(s.boost_score * 100) / 100.0,
                'trending', round(s.trending_score * 100) / 100.0,
                'cold_start', round(s.cold_start_score * 100) / 100.0,
                'semantic', round(s.semantic_score * 100) / 100.0,
                'weights', jsonb_build_object(
                    'skill', s.skill_weight, 'role', s.role_weight, 'location', s.location_weight,
                    'salary', s.salary_weight, 'experience', s.experience_weight,
                    'freshness', s.freshness_weight, 'boost', s.boost_weight,
                    'trending', s.trending_weight, 'cold_start', s.cold_start_weight,
                    'semantic', s.semantic_weight
                )
            ) AS score_breakdown,
            CASE
                WHEN NOT _is_cold_start THEN 'personalized'
                WHEN s.category_has_signal THEN 'popular_in_category'
                ELSE 'citywide_fresh'
            END AS recommendation_stage,
            ROW_NUMBER() OVER (PARTITION BY s.company_id ORDER BY
                s.skill_score * s.skill_weight + s.role_score * s.role_weight +
                s.location_score * s.location_weight + s.salary_score * s.salary_weight +
                s.experience_score * s.experience_weight + s.freshness_score * s.freshness_weight +
                s.boost_score * s.boost_weight + s.trending_score * s.trending_weight +
                s.cold_start_score * s.cold_start_weight + s.semantic_score * s.semantic_weight DESC
            ) AS company_rank
        FROM scored s
    )
    SELECT
        fs.id, fs.company_id, fs.title, fs.city, fs.state, fs.locality,
        fs.min_salary, fs.max_salary, fs.salary_period, fs.job_type, fs.work_mode,
        fs.min_experience_years, fs.max_experience_years, fs.education, fs.skills,
        fs.created_at, fs.pay_type, fs.avg_incentive_monthly, fs.company_name, fs.company_is_verified,
        (fs.boost_ends_at IS NOT NULL) AS boosted,
        round(fs.final_score::numeric, 4) AS score,
        fs.score_breakdown,
        fs.recommendation_stage,
        count(*) OVER() AS total_count
    FROM final_scored fs
    CROSS JOIN s
    -- Relevance gate: a department match (role 1.0 or neighbouring 0.75) counts,
    -- as does a real skill, title or semantic fit. Cold start is the only bypass.
    -- Applies regardless of sort — "Newest"/"Salary high" etc. still only show
    -- jobs relevant to the candidate, they just reorder within that set.
    -- Requirement 7: department_ok is a separate, additional AND-condition —
    -- a job outside the candidate's department(s)/neighbours can no longer
    -- pass this gate purely via skill_score or semantic_score. It only
    -- applies in recommended mode (_relevant_only IS TRUE); department_ok is
    -- always true otherwise (and always true for cold-start candidates).
    WHERE (
        _relevant_only IS NOT TRUE OR _is_cold_start OR
        fs.skill_score >= s.relevant_skill_threshold OR
        fs.role_score >= s.relevant_role_threshold OR
        fs.semantic_score >= s.relevant_semantic_threshold
    )
    AND (_relevant_only IS NOT TRUE OR fs.department_ok)
    ORDER BY
        -- Exactly one of these CASE expressions is non-null for every row (the
        -- one matching _sort); the rest evaluate to NULL for every row and so
        -- contribute no ordering, falling through to the next column.
        CASE WHEN _sort = 'recommended' THEN (fs.company_rank > s.max_same_company_in_top) END ASC,
        CASE WHEN _sort = 'recommended' THEN fs.final_score END DESC,
        CASE WHEN _sort = 'newest' THEN fs.created_at END DESC,
        CASE WHEN _sort = 'oldest' THEN fs.created_at END ASC,
        CASE WHEN _sort = 'salary_high' THEN fs.max_salary END DESC NULLS LAST,
        CASE WHEN _sort = 'salary_low' THEN fs.min_salary END ASC NULLS LAST,
        fs.created_at DESC
    LIMIT _limit OFFSET _offset;
END;
$$;

REVOKE ALL ON FUNCTION public.recommend_jobs_for_candidate(
    int, int, text, text, text, text, text, int, int, int, int, timestamptz, text, text, text, text, boolean, boolean, boolean, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recommend_jobs_for_candidate(
    int, int, text, text, text, text, text, int, int, int, int, timestamptz, text, text, text, text, boolean, boolean, boolean, text
) TO authenticated;
