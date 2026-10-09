-- ============================================================
-- Golden-master equivalence harness for public.recommend_jobs_for_candidate (V1 feed)
--
-- Run (LOCAL db only, fixtures loaded):
--   docker exec -i supabase_db_swdntxurukbkyksuyzhg psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/v1_equivalence.sql
--   ... with the pagination/determinism property of the NEW function also checked:
--   docker exec -i supabase_db_swdntxurukbkyksuyzhg psql -U postgres -v ON_ERROR_STOP=1 -v check_determinism=on -q < supabase/tests/v1_equivalence.sql
--
-- What it does: creates pg_temp.v1_legacy = an exact copy of the V1 body as of migration
-- 20261006093130_recommend_jobs_for_candidate_sort.sql (only the function name differs) and compares
-- the live public.recommend_jobs_for_candidate against it over a matrix of
--   14 fixture candidates x 5 sorts x ~38 argument sets (filters), plus paged (limit 7) comparisons.
-- Everything runs inside BEGIN ... ROLLBACK; the database is fingerprinted before and after and the
-- script fails if anything changed. (Inside the transaction a few jobs get required_assets =
-- {Two-wheeler} so the _vehicle filter is not vacuous; this is rolled back.)
--
-- EQUIVALENCE DEFINITION (per comparison; legacy is requested with limit 1000, offset 0)
--   1. same row count;
--   2. same total_count on every row;
--   3. same SET of ids (no duplicates on either side);
--   4. for every id, ALL 25 output columns identical (to_jsonb of the whole row; score_breakdown is
--      compared as jsonb, so key order/number scale are irrelevant but keys and values are not);
--   5. the position-by-position SEQUENCE of sort-key values is identical
--      (recommended -> score, newest/oldest -> created_at, salary_high -> max_salary,
--       salary_low -> min_salary). Order may therefore differ ONLY inside groups of exactly-equal sort
--      keys. Today's function has no unique tiebreaker, so tie order is unstable; tolerating exactly
--      that, and nothing more, is the point.
--   Paged mode (limit 7, offsets 0,7,14,...): each page must have the same row count, total_count and
--   sort-key sequence as the corresponding SLICE of the legacy full list, and each returned row must
--   equal the legacy row of the same id. (Across a page boundary a tie group may be split
--   differently, so only the key sequence - not the id set - is compared per page.)
--
-- DETERMINISM / PAGINATION (new function only; -v check_determinism=on, default OFF):
--   for 5 candidates x 5 sorts x {default, relevant_only}: pages of 7 concatenated == the limit-1000
--   list, id by id, with no duplicates or skips. Today's function violates this on tie groups
--   (LIMIT n changes the sort algorithm / tie order); it is expected to pass after the rewrite.
--
-- LIMITATIONS (honest list)
--   * Sequences compare the sort key only. For 'recommended' the real order is
--     (company_rank > max_same_company_in_top), final_score; company_rank is not an output column, so a
--     bug that only reorders rows inside equal-rounded-score groups is invisible, and the over-cap
--     demotion is checked only through its effect on the score sequence.
--   * Fixture data is small (~47 active jobs) so every result fits in one page of 1000; plan-shape-
--     dependent behaviour at scale is covered by the synthetic benchmark (Task 3), not here.
--   * Row order is taken from WITH ORDINALITY on the function call (the documented way to number
--     function output in return order), not from row_number() OVER ().
--   * Both functions run in one transaction, so now() is identical for both (freshness/boost agree).
-- ============================================================

\if :{?check_determinism}
\else
\set check_determinism off
\endif

-- Fingerprint the database before (restored by ROLLBACK; verified at the end).
SELECT md5(concat_ws('|',
    (SELECT md5(string_agg(to_jsonb(rs)::text, '' ORDER BY rs.id)) FROM public.recommendation_settings rs),
    (SELECT md5(string_agg(to_jsonb(j)::text, '' ORDER BY j.id)) FROM public.jobs j),
    (SELECT count(*) FROM public.jobs), (SELECT count(*) FROM public.candidate_profiles),
    (SELECT count(*) FROM public.job_impressions), (SELECT count(*) FROM public.applications),
    (SELECT count(*) FROM public.candidate_preferences), (SELECT count(*) FROM public.job_boosts)
)) AS fp \gset before_

BEGIN;

-- Make the _vehicle filter non-vacuous (no fixture job requires a two-wheeler). Rolled back.
UPDATE public.jobs SET required_assets = ARRAY['Two-wheeler']
WHERE status = 'active' AND category IN ('Delivery', 'Driver');

-- ------------------------------------------------------------
-- LEGACY COPY: lines 26-333 of 20261006093130_recommend_jobs_for_candidate_sort.sql, verbatim, with ONLY
-- the function name changed to pg_temp.v1_legacy. Do not tidy anything below this line until END LEGACY.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.v1_legacy(
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
BEGIN
    IF _uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated';
    END IF;

    -- Defense-in-depth: an unrecognised sort value falls back to the default
    -- relevance ranking instead of silently matching no ORDER BY branch below.
    IF _sort NOT IN ('recommended', 'newest', 'oldest', 'salary_high', 'salary_low') THEN
        _sort := 'recommended';
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
    WHERE (
        _relevant_only IS NOT TRUE OR _is_cold_start OR
        fs.skill_score >= s.relevant_skill_threshold OR
        fs.role_score >= s.relevant_role_threshold OR
        fs.semantic_score >= s.relevant_semantic_threshold
    )
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

-- ------------------------------------------------------------
-- END LEGACY
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- Harness machinery
-- ------------------------------------------------------------
CREATE TEMP TABLE v1_stats (
    compared int NOT NULL DEFAULT 0, nonempty int NOT NULL DEFAULT 0, rows_total bigint NOT NULL DEFAULT 0,
    order_differs int NOT NULL DEFAULT 0, paged int NOT NULL DEFAULT 0,
    b_empty int NOT NULL DEFAULT 0, b_small int NOT NULL DEFAULT 0, b_mid int NOT NULL DEFAULT 0, b_large int NOT NULL DEFAULT 0
);
INSERT INTO v1_stats DEFAULT VALUES;

CREATE TEMP TABLE v1_argsets (
    ord serial, label text PRIMARY KEY, args text NOT NULL, expect_empty boolean NOT NULL DEFAULT false, paged boolean NOT NULL DEFAULT false
);
CREATE TEMP TABLE v1_cov (label text PRIMARY KEY, runs int NOT NULL DEFAULT 0, nonempty int NOT NULL DEFAULT 0, max_rows int NOT NULL DEFAULT 0);

-- Impersonate a user for auth.uid() (SECURITY DEFINER functions read the JWT claims).
CREATE FUNCTION pg_temp.act_as(_uid uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    IF auth.uid() IS DISTINCT FROM _uid THEN
        RAISE EXCEPTION 'v1_equivalence harness: auth.uid() is % after impersonating %', auth.uid(), _uid;
    END IF;
END $f$;

-- Compare the live function with the legacy copy for one (candidate, sort, args) and one window.
-- _limit/_offset default to the full list; a smaller window is compared against the matching slice of
-- the legacy full list. Returns the legacy row count (the size of the full result).
-- Failures use RAISE EXCEPTION (not ASSERT) so they cannot be silenced by plpgsql.check_asserts = off.
CREATE FUNCTION pg_temp.v1_equiv(_uid uuid, _label text, _sort text, _call_args text,
                                 _limit int DEFAULT 1000, _offset int DEFAULT 0) RETURNS int
LANGUAGE plpgsql AS $f$
DECLARE
    a jsonb; b jsonb; a_slice jsonb;
    skey text; ka jsonb; kb jsonb;
    n_a int; n_b int; n_slice int;
    full_mode boolean := (_limit = 1000 AND _offset = 0);
    tag text := format('%s [uid=%s sort=%s limit=%s offset=%s]', _label, right(_uid::text, 4), _sort, _limit, _offset);
    pos int;
BEGIN
    skey := CASE _sort WHEN 'recommended' THEN 'score' WHEN 'salary_high' THEN 'max_salary'
                       WHEN 'salary_low' THEN 'min_salary' WHEN 'newest' THEN 'created_at' WHEN 'oldest' THEN 'created_at' END;
    IF skey IS NULL THEN RAISE EXCEPTION 'v1_equivalence harness: unknown sort %', _sort; END IF;
    PERFORM pg_temp.act_as(_uid);

    EXECUTE format($q$SELECT coalesce(jsonb_agg((to_jsonb(x) - 'ordinality') || jsonb_build_object('ord', x.ordinality) ORDER BY x.ordinality), '[]'::jsonb)
        FROM pg_temp.v1_legacy(_limit => 1000, _offset => 0, _sort => %L %s) WITH ORDINALITY AS x$q$, _sort, _call_args) INTO a;
    EXECUTE format($q$SELECT coalesce(jsonb_agg((to_jsonb(x) - 'ordinality') || jsonb_build_object('ord', x.ordinality) ORDER BY x.ordinality), '[]'::jsonb)
        FROM public.recommend_jobs_for_candidate(_limit => %s, _offset => %s, _sort => %L %s) WITH ORDINALITY AS x$q$,
        _limit, _offset, _sort, _call_args) INTO b;

    n_a := jsonb_array_length(a);
    n_b := jsonb_array_length(b);

    -- Harness self-checks: the legacy list must be complete, duplicate-free, 25 columns wide, and carry a
    -- total_count equal to its own length (otherwise the comparison below would be meaningless).
    IF n_a >= 1000 THEN RAISE EXCEPTION '%: legacy result hit the harness limit of 1000 rows (truncated)', tag; END IF;
    IF n_a > 0 THEN
        IF (SELECT count(DISTINCT e->>'id') FROM jsonb_array_elements(a) e) <> n_a THEN
            RAISE EXCEPTION '%: legacy result contains duplicate ids', tag; END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(a) e WHERE (SELECT count(*) FROM jsonb_object_keys(e)) <> 26) THEN
            RAISE EXCEPTION '%: legacy row does not have 25 columns + ord', tag; END IF;
        IF (a->0->>'total_count')::int <> n_a THEN
            RAISE EXCEPTION '%: legacy total_count % <> row count %', tag, a->0->>'total_count', n_a; END IF;
    END IF;
    IF n_b > 0 AND EXISTS (SELECT 1 FROM jsonb_array_elements(b) e WHERE (SELECT count(*) FROM jsonb_object_keys(e)) <> 26) THEN
        RAISE EXCEPTION '%: new function row does not have 25 columns + ord', tag; END IF;

    SELECT coalesce(jsonb_agg(e ORDER BY (e->>'ord')::int), '[]'::jsonb) INTO a_slice
    FROM jsonb_array_elements(a) e WHERE (e->>'ord')::int > _offset AND (e->>'ord')::int <= _offset + _limit;
    n_slice := jsonb_array_length(a_slice);

    -- 1. row count
    IF n_slice <> n_b THEN RAISE EXCEPTION '%: row count legacy=% new=%', tag, n_slice, n_b; END IF;
    -- 2. total_count (every row of the new result must report the legacy total)
    IF n_b > 0 AND EXISTS (SELECT 1 FROM jsonb_array_elements(b) e WHERE e->>'total_count' IS DISTINCT FROM a->0->>'total_count') THEN
        RAISE EXCEPTION '%: total_count legacy=% new=%', tag, a->0->>'total_count',
            (SELECT string_agg(DISTINCT e->>'total_count', ',') FROM jsonb_array_elements(b) e); END IF;
    -- 3. ids unique and (full mode) the same set
    IF (SELECT count(DISTINCT e->>'id') FROM jsonb_array_elements(b) e) <> n_b THEN
        RAISE EXCEPTION '%: new result contains duplicate ids', tag; END IF;
    IF full_mode AND (SELECT coalesce(jsonb_agg(e->>'id' ORDER BY e->>'id'), '[]') FROM jsonb_array_elements(a) e)
                  IS DISTINCT FROM (SELECT coalesce(jsonb_agg(e->>'id' ORDER BY e->>'id'), '[]') FROM jsonb_array_elements(b) e) THEN
        RAISE EXCEPTION '%: id set differs', tag; END IF;
    -- 4. every returned row equals the legacy row with the same id, column by column
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(b) eb
        LEFT JOIN jsonb_array_elements(a) ea ON ea->>'id' = eb->>'id'
        WHERE ea IS NULL OR (ea - 'ord') IS DISTINCT FROM (eb - 'ord')) THEN
        RAISE EXCEPTION '%: row content differs for id %', tag, (
            SELECT eb->>'id' FROM jsonb_array_elements(b) eb LEFT JOIN jsonb_array_elements(a) ea ON ea->>'id' = eb->>'id'
            WHERE ea IS NULL OR (ea - 'ord') IS DISTINCT FROM (eb - 'ord') ORDER BY (eb->>'ord')::int LIMIT 1);
    END IF;
    -- 5. sort-key sequence, position by position
    SELECT coalesce(jsonb_agg(e->skey ORDER BY (e->>'ord')::int), '[]') INTO ka FROM jsonb_array_elements(a_slice) e;
    SELECT coalesce(jsonb_agg(e->skey ORDER BY (e->>'ord')::int), '[]') INTO kb FROM jsonb_array_elements(b) e;
    IF ka IS DISTINCT FROM kb THEN
        SELECT min(i) INTO pos FROM generate_series(0, n_b - 1) i WHERE ka->i IS DISTINCT FROM kb->i;
        RAISE EXCEPTION '%: sort-key (%) sequence differs at position % (legacy % vs new %)', tag, skey, pos + 1, ka->pos, kb->pos;
    END IF;

    UPDATE pg_temp.v1_stats SET
        compared = compared + 1,
        nonempty = nonempty + (n_b > 0)::int,
        rows_total = rows_total + n_b,
        paged = paged + (NOT full_mode)::int,
        order_differs = order_differs + ((SELECT jsonb_agg(e->>'id' ORDER BY (e->>'ord')::int) FROM jsonb_array_elements(a_slice) e)
                                         IS DISTINCT FROM (SELECT jsonb_agg(e->>'id' ORDER BY (e->>'ord')::int) FROM jsonb_array_elements(b) e))::int,
        b_empty = b_empty + (full_mode AND n_b = 0)::int,
        b_small = b_small + (full_mode AND n_b BETWEEN 1 AND 5)::int,
        b_mid   = b_mid   + (full_mode AND n_b BETWEEN 6 AND 20)::int,
        b_large = b_large + (full_mode AND n_b > 20)::int;
    RETURN n_a;
END $f$;

-- ------------------------------------------------------------
-- Argument sets. Values were chosen from the fixture contents so results are a mix of empty, small and
-- large: cities Delhi/New Delhi 14, Jaipur 10, Pune 10, Mumbai 9 ...; categories Sales 6, Security 6,
-- Delivery 5 ...; job_type full_time 41 / part_time 3 / contract 2; salaries min 11k-22k, max 15k-35k.
-- ILIKE-backed filters (_q, _city, _company) deliberately use values whose letter case differs from the data
-- so that a case-sensitive LIKE would change the result.
-- ------------------------------------------------------------
INSERT INTO v1_argsets (label, args, expect_empty, paged) VALUES
    ('default',          $a$$a$,                                                            false, true),
    ('relevant_only',    $a$, _relevant_only => true$a$,                                    false, true),
    ('city_delhi_lc',    $a$, _city => 'delhi'$a$,                                          false, true),
    ('city_pune_uc',     $a$, _city => 'PUNE'$a$,                                           false, false),
    ('city_none',        $a$, _city => 'Atlantis'$a$,                                       true,  false),
    ('category_driver',  $a$, _category => 'Driver'$a$,                                     false, false),
    ('category_sales',   $a$, _category => 'Sales'$a$,                                      false, false),
    ('category_none',    $a$, _category => 'Nonexistent'$a$,                                true,  false),
    ('q_driver_lc',      $a$, _q => 'driver'$a$,                                            false, false),
    ('q_sales_uc',       $a$, _q => 'SALES'$a$,                                             false, false),
    ('q_man',            $a$, _q => 'man'$a$,                                               false, false),
    ('q_percent',        $a$, _q => '%'$a$,                                                 false, false),
    ('q_underscore',     $a$, _q => '_'$a$,                                                 false, false),
    ('q_none',           $a$, _q => 'zzzzz'$a$,                                             true,  false),
    ('job_full_time',    $a$, _job_type => 'full_time'$a$,                                  false, false),
    ('job_part_time',    $a$, _job_type => 'part_time'$a$,                                  false, false),
    ('job_contract',     $a$, _job_type => 'contract'$a$,                                   false, false),
    ('mode_field',       $a$, _work_mode => 'field'$a$,                                     false, false),
    ('mode_remote',      $a$, _work_mode => 'remote'$a$,                                    false, false),
    ('salary_wide',      $a$, _min_salary => 15000, _max_salary => 40000$a$,                false, false),
    ('salary_narrow',    $a$, _min_salary => 18000, _max_salary => 30000$a$,                false, false),
    ('salary_min_only',  $a$, _min_salary => 20000$a$,                                      false, false),
    ('exp_1_5',          $a$, _min_exp => 1, _max_exp => 5$a$,                              false, false),
    ('exp_max0',         $a$, _max_exp => 0$a$,                                             false, false),
    ('exp_min8',         $a$, _min_exp => 8$a$,                                             false, false),
    ('verified_only',    $a$, _verified_only => true$a$,                                    false, true),
    ('posted_10d',       $a$, _posted_after => now() - interval '10 days'$a$,               false, false),
    ('posted_3d',        $a$, _posted_after => now() - interval '3 days'$a$,                false, false),
    ('posted_future',    $a$, _posted_after => now() + interval '1 day'$a$,                 true,  false),
    ('vehicle',          $a$, _vehicle => true$a$,                                          false, false),
    ('education',        $a$, _education => '10th Pass'$a$,                                 false, false),
    ('shift_day',        $a$, _shift => 'day'$a$,                                           false, false),
    ('english_basic',    $a$, _english_level => 'Basic'$a$,                                 false, false),
    ('company_lc',       $a$, _company => 'fixture'$a$,                                     false, false),
    ('combo_delhi_rel_ft', $a$, _city => 'delhi', _relevant_only => true, _job_type => 'full_time'$a$, false, true),
    ('combo_ver_sal_exp_post', $a$, _verified_only => true, _min_salary => 15000, _max_salary => 40000, _posted_after => now() - interval '20 days', _min_exp => 0, _max_exp => 4$a$, false, false),
    ('combo_q_cat_rel',  $a$, _q => 'sales', _category => 'Sales', _relevant_only => true$a$, false, false),
    ('combo_vehicle_field_rel', $a$, _vehicle => true, _work_mode => 'field', _relevant_only => true$a$, false, false);
-- (the 'default' set is the empty string; the dollar-quoted "$a$$a$" above is exactly that)

-- ------------------------------------------------------------
-- Preconditions: the fixtures must be present
-- ------------------------------------------------------------
DO $$
BEGIN
    IF (SELECT count(*) FROM public.candidate_profiles WHERE user_id::text ~ '^00000000-0000-4000-8000-00000000c0(0[1-9]|1[0-4])$') <> 14 THEN
        RAISE EXCEPTION 'v1_equivalence: the 14 fixture candidates c001..c014 are not loaded (run supabase/tests/fixtures/seed_local.sql)';
    END IF;
    IF (SELECT count(*) FROM public.jobs WHERE status = 'active') < 40 THEN
        RAISE EXCEPTION 'v1_equivalence: fixture jobs are not loaded';
    END IF;
END $$;

-- ------------------------------------------------------------
-- The matrix: candidates x sorts x argument sets (full list), then paged windows for flagged sets
-- ------------------------------------------------------------
DO $$
DECLARE
    uid uuid; s text; r record; n int; offs int; tot int;
    sorts text[] := ARRAY['recommended', 'newest', 'oldest', 'salary_high', 'salary_low'];
BEGIN
    FOR i IN 1..14 LOOP
        uid := ('00000000-0000-4000-8000-00000000c0' || lpad(i::text, 2, '0'))::uuid;
        FOREACH s IN ARRAY sorts LOOP
            FOR r IN SELECT * FROM pg_temp.v1_argsets ORDER BY ord LOOP
                n := pg_temp.v1_equiv(uid, r.label, s, r.args);
                INSERT INTO pg_temp.v1_cov AS c (label, runs, nonempty, max_rows) VALUES (r.label, 1, (n > 0)::int, n)
                ON CONFLICT (label) DO UPDATE SET runs = c.runs + 1, nonempty = c.nonempty + (n > 0)::int, max_rows = greatest(c.max_rows, n);
                IF r.expect_empty AND n <> 0 THEN
                    RAISE EXCEPTION 'v1_equivalence: argument set % was expected to be empty but legacy returned % rows (uid %, sort %)', r.label, n, i, s;
                END IF;
                -- paged windows of 7 across the whole list (plus one window past the end)
                IF r.paged THEN
                    offs := 0;
                    WHILE offs <= n LOOP
                        PERFORM pg_temp.v1_equiv(uid, r.label || ':page', s, r.args, 7, offs);
                        offs := offs + 7;
                    END LOOP;
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;
END $$;

-- Coverage: every non-empty-expected argument set must return rows for at least one candidate/sort, and the
-- run as a whole must cover empty, small and large result sets. A harness that only compares empty lists
-- proves nothing.
DO $$
DECLARE st record; bad text; cv record;
BEGIN
    SELECT * INTO st FROM pg_temp.v1_stats;
    FOR cv IN SELECT c.*, a.expect_empty FROM pg_temp.v1_cov c JOIN pg_temp.v1_argsets a USING (label) ORDER BY a.ord LOOP
        RAISE NOTICE 'coverage  % runs=%  non-empty=%  max rows=%', rpad(cv.label, 26), cv.runs, cv.nonempty, cv.max_rows;
    END LOOP;
    SELECT string_agg(c.label, ', ') INTO bad FROM pg_temp.v1_cov c JOIN pg_temp.v1_argsets a USING (label)
    WHERE NOT a.expect_empty AND c.nonempty = 0;
    IF bad IS NOT NULL THEN RAISE EXCEPTION 'v1_equivalence: vacuous argument sets (always empty): %', bad; END IF;
    IF st.compared < 600 THEN RAISE EXCEPTION 'v1_equivalence: only % comparisons ran (need >= 600)', st.compared; END IF;
    IF st.nonempty < 300 THEN RAISE EXCEPTION 'v1_equivalence: only % non-empty comparisons (need >= 300)', st.nonempty; END IF;
    IF st.b_empty = 0 OR st.b_small = 0 OR st.b_mid = 0 OR st.b_large = 0 THEN
        RAISE EXCEPTION 'v1_equivalence: result-size mix is not covered (empty %, 1-5 %, 6-20 %, >20 %)', st.b_empty, st.b_small, st.b_mid, st.b_large;
    END IF;
    RAISE NOTICE 'result sizes (full-list comparisons): empty=%, 1-5=%, 6-20=%, >20=%', st.b_empty, st.b_small, st.b_mid, st.b_large;
    RAISE NOTICE 'paged-window comparisons: %; comparisons where id order differed inside tie groups (tolerated): %', st.paged, st.order_differs;
    RAISE NOTICE 'v1_equivalence: % comparisons OK (% non-empty, % result rows compared)', st.compared, st.nonempty, st.rows_total;
END $$;

-- ------------------------------------------------------------
-- Determinism + pagination continuity of the NEW function only (psql -v check_determinism=on).
-- Today's function is expected to FAIL this on tie groups; it must pass after Task 2.
-- ------------------------------------------------------------
\if :check_determinism
DO $$
DECLARE
    uid uuid; s text; arg text; full_ids text[]; paged_ids text[]; pg text[]; offs int; fails int := 0; checks int := 0;
    cands text[] := ARRAY['c001', 'c005', 'c007', 'c010', 'c013'];
    c text;
BEGIN
    FOREACH c IN ARRAY cands LOOP
        uid := ('00000000-0000-4000-8000-00000000' || c)::uuid;
        PERFORM pg_temp.act_as(uid);
        FOREACH s IN ARRAY ARRAY['recommended', 'newest', 'oldest', 'salary_high', 'salary_low'] LOOP
            FOREACH arg IN ARRAY ARRAY['', ', _relevant_only => true'] LOOP
                EXECUTE format($q$SELECT coalesce(array_agg(x.id::text ORDER BY x.ordinality), '{}') FROM public.recommend_jobs_for_candidate(_limit => 1000, _offset => 0, _sort => %L %s) WITH ORDINALITY x$q$, s, arg) INTO full_ids;
                paged_ids := '{}'; offs := 0;
                LOOP
                    EXECUTE format($q$SELECT coalesce(array_agg(x.id::text ORDER BY x.ordinality), '{}') FROM public.recommend_jobs_for_candidate(_limit => 7, _offset => %s, _sort => %L %s) WITH ORDINALITY x$q$, offs, s, arg) INTO pg;
                    paged_ids := paged_ids || pg;
                    EXIT WHEN cardinality(pg) < 7 OR offs > 1000;
                    offs := offs + 7;
                END LOOP;
                checks := checks + 1;
                IF paged_ids IS DISTINCT FROM full_ids THEN
                    fails := fails + 1;
                    RAISE NOTICE 'DETERMINISM FAIL %/% %: paged(7) list differs from full list (full % ids, paged % ids, % distinct paged, first difference at position %)',
                        c, s, coalesce(nullif(arg, ''), 'default'), cardinality(full_ids), cardinality(paged_ids),
                        (SELECT count(DISTINCT v) FROM unnest(paged_ids) v),
                        (SELECT min(i) FROM generate_series(1, greatest(cardinality(full_ids), cardinality(paged_ids))) i WHERE full_ids[i] IS DISTINCT FROM paged_ids[i]);
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;
    IF fails > 0 THEN
        RAISE EXCEPTION 'v1_equivalence determinism check: % of % pagination checks failed (duplicate/skipped/reordered rows across pages)', fails, checks;
    END IF;
    RAISE NOTICE 'v1_equivalence determinism: % pagination checks OK', checks;
END $$;
\else
\echo 'v1_equivalence: determinism/pagination check skipped (pass -v check_determinism=on to run it)'
\endif

ROLLBACK;

-- The database must be exactly as it was before the harness ran.
SELECT md5(concat_ws('|',
    (SELECT md5(string_agg(to_jsonb(rs)::text, '' ORDER BY rs.id)) FROM public.recommendation_settings rs),
    (SELECT md5(string_agg(to_jsonb(j)::text, '' ORDER BY j.id)) FROM public.jobs j),
    (SELECT count(*) FROM public.jobs), (SELECT count(*) FROM public.candidate_profiles),
    (SELECT count(*) FROM public.job_impressions), (SELECT count(*) FROM public.applications),
    (SELECT count(*) FROM public.candidate_preferences), (SELECT count(*) FROM public.job_boosts)
)) = :'before_fp' AS untouched \gset
\if :untouched
\echo 'v1_equivalence: database fingerprint unchanged (rolled back cleanly)'
\else
DO $$ BEGIN RAISE EXCEPTION 'v1_equivalence: database fingerprint CHANGED - the harness left residue'; END $$;
\endif
