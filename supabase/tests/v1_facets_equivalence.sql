-- ============================================================
-- Faceted-embedding extension of the V1 feed (20261009130307_faceted_embeddings.sql)
--
-- Run (LOCAL db only, fixtures loaded):
--   docker exec -i supabase_db_swdntxurukbkyksuyzhg psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/v1_facets_equivalence.sql
--
-- The faceted migration deliberately changes V1 output (two new score_breakdown keys + a reduced
-- semantic_weight), so full equivalence with the live body does not hold. What must hold instead:
--   (a) ADDITIVITY  with semantic_skill_weight = semantic_role_weight = 0 and semantic_weight restored to its
--       pre-rebalance value (inside the transaction), the live function returns exactly what the frozen
--       live body (pg_temp.v1_live_ref, copied from 20261010180000_fold_job_matches_search_into_live_function.sql
--       with only the name changed and a final `id` ORDER BY tiebreak added) returns - all 25 columns, row order, total_count - once the four new
--       jsonb paths (score_breakdown.semantic_skill/semantic_role and the same names in .weights) are removed
--       after asserting they are present. Checked for 6 candidates (incl. c001 with known facet test vectors
--       and c004 with no embeddings at all) x 5 sorts x 5 argument sets.
--   (b) new keys present with values in [0,1]; known cosines give the expected values; reported score equals
--       the weighted sum of the breakdown (rounding tolerance), proving the terms are in the final score.
--   (c) neutral 0.5 whenever either side's facet embedding is NULL (baseline fixtures have none; also
--       job-side-only and candidate-side-only facets).
--   (d) the 12 weights still sum to within 0.02 of the pre-migration sum.
--   (e) relevance gate, explicit sorts and diversity ordering still behave (a compares gated and sorted lists
--       row for row; diversity demotion verified separately with max_same_company_in_top = 1).
--   (f) the explicit-sort fast path (a page of a non-'recommended' sort) returns the same rows, scores,
--       breakdowns (incl. the new keys) and total_count as the full-scoring path re-sorted the same way.
--       (That the fast path scores ONLY the page is structural - unchanged "chosen" CTE - not observable here.)
-- Everything runs inside BEGIN ... ROLLBACK; a fingerprint of the touched tables is verified afterwards.
-- ============================================================

SELECT md5(concat_ws('|',
    (SELECT md5(string_agg(to_jsonb(rs)::text, '' ORDER BY rs.id)) FROM public.recommendation_settings rs),
    (SELECT md5(string_agg(to_jsonb(j)::text, '' ORDER BY j.id)) FROM public.jobs j),
    (SELECT md5(string_agg(to_jsonb(cp)::text, '' ORDER BY cp.user_id)) FROM public.candidate_profiles cp),
    (SELECT count(*) FROM public.job_impressions), (SELECT count(*) FROM public.applications)
)) AS fp \gset before_

BEGIN;

-- ------------------------------------------------------------
-- FROZEN COPY of the teammate's live body (20261010180000_fold_job_matches_search_into_live_function.sql,
-- lines 64-423) as pg_temp.v1_live_ref. Only two differences: the function name, and a final `fs.id` ORDER BY
-- tiebreak (the live body has none; with it the reference is deterministic, like the new function). Do not edit.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.v1_live_ref(
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
          -- Browse search: title match, OR job_matches_search()'s two extra
          -- strategies (multi-word token coverage over title/category/
          -- skills; a curated Sales/Marketing/Software related-terms regex
          -- on the title — folded in from job_matches_search(),
          -- 20261007120000, so Browse benefits without needing a separate,
          -- currently-uncalled helper), OR department match (_q_category).
          AND (
              _q IS NULL
              OR public.job_matches_search(_q, j.title, j.category, j.skills)
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
          -- Saved onboarding preferences (salary/experience/job type/work
          -- mode) only narrow Recommendations (_relevant_only = true), never
          -- Browse. Browse has its own explicit, visible filter controls
          -- (_job_type, _work_mode, _min_salary, etc. above); a candidate's
          -- saved preference silently narrowing Browse search results (e.g.
          -- a saved job_types=['full_time'] hiding internship/contract Sales
          -- jobs from a "sales" search) is the reported bug this fixes.
          AND (_relevant_only IS NOT TRUE OR _prefs IS NULL OR _prefs.min_salary_monthly IS NULL OR j.max_salary IS NULL OR j.max_salary >= _prefs.min_salary_monthly)
          AND (_relevant_only IS NOT TRUE OR _prefs IS NULL OR _prefs.max_salary_monthly IS NULL OR j.min_salary IS NULL OR j.min_salary <= _prefs.max_salary_monthly)
          AND (_relevant_only IS NOT TRUE OR _prefs IS NULL OR _prefs.min_experience_years IS NULL OR j.max_experience_years IS NULL OR j.max_experience_years >= _prefs.min_experience_years)
          AND (_relevant_only IS NOT TRUE OR _prefs IS NULL OR _prefs.max_experience_years IS NULL OR j.min_experience_years IS NULL OR j.min_experience_years <= _prefs.max_experience_years)
          AND (_relevant_only IS NOT TRUE OR _prefs IS NULL OR COALESCE(cardinality(_prefs.job_types), 0) = 0 OR j.job_type::text = ANY(_prefs.job_types))
          AND (_relevant_only IS NOT TRUE OR _prefs IS NULL OR COALESCE(cardinality(_prefs.work_modes), 0) = 0 OR j.work_mode::text = ANY(_prefs.work_modes))
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
        fs.created_at DESC,
        fs.id   -- harness-only: the teammate's live body has no unique tiebreak; this makes the frozen reference deterministic (see header)
    LIMIT _limit OFFSET _offset;
END;
$$;

-- ------------------------------------------------------------
-- END FROZEN COPY
-- ------------------------------------------------------------

CREATE FUNCTION pg_temp.act_as(_uid uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    IF auth.uid() IS DISTINCT FROM _uid THEN
        RAISE EXCEPTION 'v1_facets: auth.uid() is % after impersonating %', auth.uid(), _uid;
    END IF;
END $f$;

CREATE FUNCTION pg_temp.cand(i int) RETURNS uuid LANGUAGE sql AS
$f$ SELECT ('00000000-0000-4000-8000-00000000c0' || lpad(i::text, 2, '0'))::uuid $f$;

-- Vector with 1.0 at the given 1-based dimensions (cosine e1 vs e2 = 0; e1 vs e1+e2 = 0.7071).
CREATE FUNCTION pg_temp.vec(VARIADIC dims int[]) RETURNS vector LANGUAGE sql AS
$f$ SELECT ('[' || string_agg((CASE WHEN g = ANY(dims) THEN 1 ELSE 0 END)::text, ',' ORDER BY g) || ']')::vector(1536)
    FROM generate_series(1, 1536) g $f$;

-- Row-set wrappers returning the function output as ordered jsonb rows (position in the key "o").
CREATE FUNCTION pg_temp.frozen_rows(_sort text, _args text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE a jsonb;
BEGIN
    EXECUTE format($q$SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.o), '[]') FROM pg_temp.v1_live_ref(_limit => 1000, _sort => %L %s)
        WITH ORDINALITY AS x(id, company_id, title, city, state, locality, min_salary, max_salary, salary_period, job_type, work_mode, min_experience_years, max_experience_years, education, skills, created_at, pay_type, avg_incentive_monthly, company_name, company_is_verified, boosted, score, score_breakdown, recommendation_stage, total_count, o)$q$,
        _sort, _args) INTO a;
    RETURN a;
END $f$;

CREATE FUNCTION pg_temp.live_rows(_sort text, _args text, _limit int DEFAULT 1000, _offset int DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE a jsonb;
BEGIN
    EXECUTE format($q$SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.o), '[]') FROM public.recommend_jobs_for_candidate(_limit => %s, _offset => %s, _sort => %L %s)
        WITH ORDINALITY AS x(id, company_id, title, city, state, locality, min_salary, max_salary, salary_period, job_type, work_mode, min_experience_years, max_experience_years, education, skills, created_at, pay_type, avg_incentive_monthly, company_name, company_is_verified, boosted, score, score_breakdown, recommendation_stage, total_count, o)$q$,
        _limit, _offset, _sort, _args) INTO a;
    RETURN a;
END $f$;

-- True when every row carries the four new keys.
CREATE FUNCTION pg_temp.has_new_keys(rows jsonb) RETURNS boolean LANGUAGE sql AS $f$
    SELECT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(rows) e
        WHERE NOT (e->'score_breakdown' ? 'semantic_skill' AND e->'score_breakdown' ? 'semantic_role'
               AND e->'score_breakdown'->'weights' ? 'semantic_skill' AND e->'score_breakdown'->'weights' ? 'semantic_role'))
$f$;

-- (a) helper: live (new keys stripped after a presence assertion) vs frozen, full list, exact order.
CREATE FUNCTION pg_temp.cmp(_uid uuid, _sort text, _args text) RETURNS int LANGUAGE plpgsql AS $f$
DECLARE a jsonb; b jsonb; tag text := format('uid=%s sort=%s args=[%s]', right(_uid::text, 4), _sort, _args);
BEGIN
    PERFORM pg_temp.act_as(_uid);
    a := pg_temp.frozen_rows(_sort, _args);
    b := pg_temp.live_rows(_sort, _args);
    IF NOT pg_temp.has_new_keys(b) THEN RAISE EXCEPTION '(a) %: new keys missing', tag; END IF;
    SELECT coalesce(jsonb_agg(e #- '{score_breakdown,semantic_skill}' #- '{score_breakdown,semantic_role}'
                                #- '{score_breakdown,weights,semantic_skill}' #- '{score_breakdown,weights,semantic_role}' ORDER BY ord), '[]')
      INTO b FROM jsonb_array_elements(b) WITH ORDINALITY AS t(e, ord);
    IF jsonb_array_length(a) <> jsonb_array_length(b) THEN
        RAISE EXCEPTION '(a) %: row count frozen=% live=%', tag, jsonb_array_length(a), jsonb_array_length(b); END IF;
    IF a IS DISTINCT FROM b THEN
        RAISE EXCEPTION '(a) %: rows differ (first differing id %)', tag, (
            SELECT ea->>'id' FROM jsonb_array_elements(a) WITH ORDINALITY ta(ea, o) JOIN jsonb_array_elements(b) WITH ORDINALITY tb(eb, o) USING (o)
            WHERE ea IS DISTINCT FROM eb ORDER BY o LIMIT 1); END IF;
    RETURN jsonb_array_length(a);
END $f$;

-- Preconditions
DO $$
BEGIN
    IF (SELECT count(*) FROM public.candidate_profiles WHERE user_id::text ~ '^00000000-0000-4000-8000-00000000c0(0[1-9]|1[0-4])$') <> 14 THEN
        RAISE EXCEPTION 'v1_facets: fixtures not loaded (run supabase/tests/fixtures/seed_local.sql)'; END IF;
    IF EXISTS (SELECT 1 FROM public.jobs WHERE skills_embedding IS NOT NULL OR role_embedding IS NOT NULL)
       OR EXISTS (SELECT 1 FROM public.candidate_profiles WHERE skills_embedding IS NOT NULL OR role_embedding IS NOT NULL) THEN
        RAISE EXCEPTION 'v1_facets: baseline expects NO facet embeddings in the fixtures'; END IF;
END $$;

-- ============================================================
-- (d) weight sum: 12 weights vs pre-migration sum (the 10 old weights with semantic restored by +0.10)
-- ============================================================
DO $$
DECLARE t12 numeric; t_pre numeric;
BEGIN
    SELECT skill_weight+role_weight+location_weight+salary_weight+experience_weight+freshness_weight+boost_weight
         + trending_weight+cold_start_weight+semantic_weight+semantic_skill_weight+semantic_role_weight,
           skill_weight+role_weight+location_weight+salary_weight+experience_weight+freshness_weight+boost_weight
         + trending_weight+cold_start_weight+semantic_weight + 0.10
    INTO t12, t_pre FROM public.recommendation_settings WHERE id = 1;
    IF abs(t12 - t_pre) > 0.02 THEN RAISE EXCEPTION '(d) 12-weight sum % vs pre-migration sum %', t12, t_pre; END IF;
    IF abs(t12 - 1.0) > 0.02 THEN RAISE EXCEPTION '(d) 12-weight sum % is not ~1.0', t12; END IF;
    RAISE NOTICE '(d) OK: 12-weight sum % (pre-migration %)', t12, t_pre;
END $$;

-- ============================================================
-- (b)+(c) baseline: no facet embeddings anywhere -> every row of every candidate: both keys exactly 0.5
-- ============================================================
DO $$
DECLARE i int; rows jsonb; tot int := 0;
BEGIN
    FOR i IN 1..14 LOOP
        PERFORM pg_temp.act_as(pg_temp.cand(i));
        rows := pg_temp.live_rows('recommended', '');
        tot := tot + jsonb_array_length(rows);
        IF NOT pg_temp.has_new_keys(rows) THEN RAISE EXCEPTION '(b) candidate %: new keys missing', i; END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(rows) e
                   WHERE (e->'score_breakdown'->>'semantic_skill')::numeric <> 0.5 OR (e->'score_breakdown'->>'semantic_role')::numeric <> 0.5) THEN
            RAISE EXCEPTION '(c) candidate %: baseline facet component is not exactly 0.5', i; END IF;
    END LOOP;
    IF tot = 0 THEN RAISE EXCEPTION '(b/c) vacuous: no rows'; END IF;
    RAISE NOTICE '(b/c) OK: % baseline rows over 14 candidates all have semantic_skill = semantic_role = 0.5', tot;
END $$;

-- ============================================================
-- Known facet vectors: c001 gets skills=e1, role=e1. Two jobs X, Y (c001's top two rows):
--   X: skills=e1 (cos 1.0), role=e2 (cos 0.0)      Y: skills=e1+e2 (cos 0.7071 -> 0.71), role=e1 (cos 1.0)
-- ============================================================
SELECT pg_temp.act_as(pg_temp.cand(1));
CREATE TEMP TABLE xy AS
SELECT (e->>'o')::int AS k, (e->>'id')::uuid AS id
FROM jsonb_array_elements(pg_temp.live_rows('recommended', '', 2, 0)) e;

UPDATE public.candidate_profiles SET skills_embedding = pg_temp.vec(1), role_embedding = pg_temp.vec(1)
WHERE user_id = pg_temp.cand(1);
UPDATE public.jobs SET skills_embedding = pg_temp.vec(1), role_embedding = pg_temp.vec(2) WHERE id = (SELECT id FROM xy WHERE k = 1);
UPDATE public.jobs SET skills_embedding = pg_temp.vec(1, 2), role_embedding = pg_temp.vec(1) WHERE id = (SELECT id FROM xy WHERE k = 2);

DO $$
DECLARE rows jsonb; e jsonb; x jsonb; y jsonb; bd jsonb; w jsonb; recon numeric; n int := 0;
BEGIN
    IF (SELECT count(*) FROM xy) <> 2 THEN RAISE EXCEPTION '(b) test jobs X/Y not found'; END IF;
    PERFORM pg_temp.act_as(pg_temp.cand(1));
    rows := pg_temp.live_rows('recommended', '');
    SELECT r->'score_breakdown' INTO x FROM jsonb_array_elements(rows) r WHERE (r->>'id')::uuid = (SELECT id FROM xy WHERE k = 1);
    SELECT r->'score_breakdown' INTO y FROM jsonb_array_elements(rows) r WHERE (r->>'id')::uuid = (SELECT id FROM xy WHERE k = 2);
    IF (x->>'semantic_skill')::numeric <> 1.00 OR (x->>'semantic_role')::numeric <> 0.00 THEN
        RAISE EXCEPTION '(b) job X expected skill 1.00 / role 0.00, got % / %', x->>'semantic_skill', x->>'semantic_role'; END IF;
    IF (y->>'semantic_skill')::numeric <> 0.71 OR (y->>'semantic_role')::numeric <> 1.00 THEN
        RAISE EXCEPTION '(b) job Y expected skill 0.71 / role 1.00, got % / %', y->>'semantic_skill', y->>'semantic_role'; END IF;

    -- every c001 row: facet keys in [0,1]; score ~ clamp(sum(component * weight)) within rounding tolerance
    FOR e IN SELECT * FROM jsonb_array_elements(rows) LOOP
        bd := e->'score_breakdown'; w := bd->'weights';
        IF (bd->>'semantic_skill')::numeric NOT BETWEEN 0 AND 1 OR (bd->>'semantic_role')::numeric NOT BETWEEN 0 AND 1 THEN
            RAISE EXCEPTION '(b) job % has facet component outside [0,1]: %', e->>'id', bd; END IF;
        SELECT sum((bd->>key)::numeric * (w->>key)::numeric) INTO recon
        FROM unnest(ARRAY['skill','role','location','salary','experience','freshness','boost','trending','cold_start','semantic','semantic_skill','semantic_role']) key;
        IF abs((e->>'score')::numeric - LEAST(1, GREATEST(0, recon))) > 0.02 THEN
            RAISE EXCEPTION '(b) job %: score % does not match weighted breakdown % (facet terms missing from final score?)', e->>'id', e->>'score', recon; END IF;
        n := n + 1;
    END LOOP;

    -- (c) candidate-side-only facets (c001) vs jobs without facets: every non-X/Y row is exactly 0.5/0.5
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(rows) r
               WHERE (r->>'id')::uuid NOT IN (SELECT id FROM xy)
                 AND ((r->'score_breakdown'->>'semantic_skill')::numeric <> 0.5 OR (r->'score_breakdown'->>'semantic_role')::numeric <> 0.5)) THEN
        RAISE EXCEPTION '(c) job without facet embeddings got a non-neutral facet component'; END IF;
    -- (c) job-side-only facets (X, Y have them) vs candidates without facets (c004 has no embeddings at all)
    PERFORM pg_temp.act_as(pg_temp.cand(4));
    rows := pg_temp.live_rows('recommended', '');
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(rows) r WHERE (r->>'id')::uuid IN (SELECT id FROM xy)) THEN
        RAISE EXCEPTION '(c) vacuous: X/Y not in the c004 feed'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(rows) r
               WHERE (r->'score_breakdown'->>'semantic_skill')::numeric <> 0.5 OR (r->'score_breakdown'->>'semantic_role')::numeric <> 0.5) THEN
        RAISE EXCEPTION '(c) candidate without facet embeddings got a non-neutral facet component'; END IF;
    RAISE NOTICE '(b) OK: X = 1.00/0.00, Y = 0.71/1.00; % c001 rows within [0,1] and score = weighted breakdown', n;
    RAISE NOTICE '(c) OK: neutral 0.5 when either side lacks the facet';
END $$;

-- ============================================================
-- (e)+(f) with the real facet weights: fast path vs full scoring, and diversity demotion (cap forced to 1)
-- ============================================================
CREATE TEMP TABLE orig_cap AS SELECT max_same_company_in_top AS cap FROM public.recommendation_settings WHERE id = 1;
UPDATE public.recommendation_settings SET max_same_company_in_top = 1 WHERE id = 1;

DO $$
DECLARE c int; full_rec jsonb; exp_newest jsonb; page jsonb; tot_page bigint; i int; demoted int := 0; n_over int; checked int := 0;
BEGIN
    FOREACH c IN ARRAY ARRAY[1, 2, 5, 7] LOOP
        PERFORM pg_temp.act_as(pg_temp.cand(c));
        -- full-scoring reference ('recommended' scores every eligible row), re-sorted as the 'newest' sort orders
        full_rec := pg_temp.live_rows('recommended', '');
        SELECT jsonb_agg(e ORDER BY (e->>'created_at')::timestamptz DESC, e->>'id') INTO exp_newest FROM jsonb_array_elements(full_rec) e;

        page := pg_temp.live_rows('newest', '', 5, 5);   -- fast path: only this page is scored
        IF jsonb_array_length(page) <> 5 THEN RAISE EXCEPTION '(f) candidate %: fast-path page has % rows', c, jsonb_array_length(page); END IF;
        IF NOT pg_temp.has_new_keys(page) THEN RAISE EXCEPTION '(f) candidate %: fast-path rows lack the new keys', c; END IF;
        FOR i IN 0..4 LOOP
            IF ((page->i) - 'o' - 'total_count') IS DISTINCT FROM ((exp_newest->(i + 5)) - 'o' - 'total_count') THEN
                RAISE EXCEPTION '(f) candidate %: fast-path row % differs from full scoring row %: % vs %', c, i, i + 5, page->i, exp_newest->(i + 5); END IF;
            IF (page->i->>'total_count') <> (jsonb_array_length(full_rec))::text THEN
                RAISE EXCEPTION '(f) candidate %: fast-path total_count % <> %', c, page->i->>'total_count', jsonb_array_length(full_rec); END IF;
        END LOOP;

        -- (e) diversity with cap = 1: every over-cap row (company's 2nd+ job in output order) comes after every in-cap row
        IF EXISTS (
            WITH o AS (SELECT e->>'company_id' AS company_id, (e->>'o')::int AS o,
                              row_number() OVER (PARTITION BY e->>'company_id' ORDER BY (e->>'o')::int) AS rn
                       FROM jsonb_array_elements(full_rec) e)
            SELECT 1 FROM o a JOIN o b ON a.rn > 1 AND b.rn <= 1 AND a.o < b.o) THEN
            RAISE EXCEPTION '(e) candidate %: an over-cap job is ranked above an in-cap job', c; END IF;
        SELECT count(*) INTO n_over FROM (
            SELECT row_number() OVER (PARTITION BY e->>'company_id' ORDER BY (e->>'o')::int) AS rn FROM jsonb_array_elements(full_rec) e) q WHERE rn > 1;
        demoted := demoted + n_over;
        checked := checked + 1;
    END LOOP;
    IF demoted = 0 THEN RAISE EXCEPTION '(e) vacuous: no over-cap rows at cap=1'; END IF;
    RAISE NOTICE '(e)+(f) OK: % candidates; fast-path pages equal full-scoring slices (rows, scores, new keys, total_count); % over-cap rows demoted behind in-cap rows', checked, demoted;
END $$;

-- ============================================================
-- (a) additivity: facet weights -> 0, semantic_weight restored; exact equality with the frozen live (20261010180000) body
-- (this also compares relevance-gated lists and all five sorts row for row, which covers the gate (e))
-- ============================================================
UPDATE public.recommendation_settings
SET semantic_weight = semantic_weight + semantic_skill_weight + semantic_role_weight,
    semantic_skill_weight = 0, semantic_role_weight = 0,
    max_same_company_in_top = (SELECT cap FROM orig_cap)   -- compare under the real diversity setting
WHERE id = 1;

CREATE TEMP TABLE a_args (label text, args text);
INSERT INTO a_args VALUES
    ('default', ''), ('relevant_only', ', _relevant_only => true'), ('city_delhi', $$, _city => 'delhi'$$),
    ('category_sales', $$, _category => 'Sales'$$), ('combo', $$, _verified_only => true, _min_salary => 15000, _relevant_only => true$$);

DO $$
DECLARE c int; s text; r record; n int; cmp int := 0; nonempty int := 0; gated int := 0;
BEGIN
    FOREACH c IN ARRAY ARRAY[1, 4, 5, 2, 13, 10] LOOP
        FOREACH s IN ARRAY ARRAY['recommended', 'newest', 'oldest', 'salary_high', 'salary_low'] LOOP
            FOR r IN SELECT * FROM a_args LOOP
                n := pg_temp.cmp(pg_temp.cand(c), s, r.args);
                cmp := cmp + 1; nonempty := nonempty + (n > 0)::int;
            END LOOP;
        END LOOP;
    END LOOP;
    IF nonempty < cmp / 2 THEN RAISE EXCEPTION '(a) vacuous: only % of % comparisons non-empty', nonempty, cmp; END IF;
    -- the relevance gate must actually filter for at least one candidate, or the gated comparisons prove little
    FOREACH c IN ARRAY ARRAY[1, 4, 5, 2, 13, 10] LOOP
        PERFORM pg_temp.act_as(pg_temp.cand(c));
        IF jsonb_array_length(pg_temp.live_rows('recommended', ', _relevant_only => true')) < jsonb_array_length(pg_temp.live_rows('recommended', '')) THEN
            gated := gated + 1; END IF;
    END LOOP;
    IF gated = 0 THEN RAISE EXCEPTION '(e) vacuous: the relevance gate removed nothing for any tested candidate'; END IF;
    RAISE NOTICE '(a) OK: % comparisons (% non-empty) identical to the frozen live (20261010180000) body when facet weights are 0; (e) gate filters for % of 6 candidates', cmp, nonempty, gated;
END $$;

ROLLBACK;

SELECT md5(concat_ws('|',
    (SELECT md5(string_agg(to_jsonb(rs)::text, '' ORDER BY rs.id)) FROM public.recommendation_settings rs),
    (SELECT md5(string_agg(to_jsonb(j)::text, '' ORDER BY j.id)) FROM public.jobs j),
    (SELECT md5(string_agg(to_jsonb(cp)::text, '' ORDER BY cp.user_id)) FROM public.candidate_profiles cp),
    (SELECT count(*) FROM public.job_impressions), (SELECT count(*) FROM public.applications)
)) AS fp \gset after_
SELECT (:'before_fp' = :'after_fp') AS fingerprint_unchanged \gset
\if :fingerprint_unchanged
\echo v1_facets_equivalence: OK, database fingerprint unchanged (rolled back cleanly)
\else
\echo v1_facets_equivalence: FINGERPRINT CHANGED
SELECT 1/0;
\endif
