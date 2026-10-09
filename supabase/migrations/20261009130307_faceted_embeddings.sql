-- ============================================================
-- Faceted (skill/role) embeddings: columns, invalidation, write-back RPCs, weights, V1 scoring extension.
--
-- The whole-document embeddings (profile_embedding / description_embedding) and their `semantic` score are
-- UNCHANGED. Two narrower embeddings per entity (skills-only, role/title-only) are added alongside, each
-- compared by cosine similarity and contributing its own small weighted component (semantic_skill /
-- semantic_role). Their weight budget is carved out of semantic_weight (relative: semantic_weight - 0.10,
-- floored at 0.02) so the 12 weights keep summing to ~1.0. Both components are neutral (0.5) while either
-- side's facet embedding is NULL (e.g. before backfill).
--
-- recommend_jobs_for_candidate is the Plan-11 V1 body (20261009103544_v1_scoring_performance.sql: materialized
-- CTE pipeline, explicit-sort fast path, plan_cache_mode) with ONLY these additions: two plpgsql variables
-- fetched in the existing candidate SELECT, two embedding columns in eligible_jobs, two score expressions +
-- weight passthrough in scored, two terms in both copies of the weighted sum in ranked, two score_breakdown
-- keys and two weights keys. No existing key is renamed or removed.
-- Rollback: re-apply the function body of 20261009103544_v1_scoring_performance.sql and
-- UPDATE recommendation_settings SET semantic_weight = semantic_weight + 0.10 WHERE id = 1 (columns may stay).
-- ============================================================

-- ── 1. Columns and indexes ──────────────────────────────────
ALTER TABLE public.candidate_profiles
    ADD COLUMN IF NOT EXISTS skills_embedding vector(1536),
    ADD COLUMN IF NOT EXISTS skills_embedding_hash text,
    ADD COLUMN IF NOT EXISTS skills_embedding_model text,
    ADD COLUMN IF NOT EXISTS skills_embedded_at timestamptz,
    ADD COLUMN IF NOT EXISTS role_embedding vector(1536),
    ADD COLUMN IF NOT EXISTS role_embedding_hash text,
    ADD COLUMN IF NOT EXISTS role_embedding_model text,
    ADD COLUMN IF NOT EXISTS role_embedded_at timestamptz;

ALTER TABLE public.jobs
    ADD COLUMN IF NOT EXISTS skills_embedding vector(1536),
    ADD COLUMN IF NOT EXISTS skills_embedding_hash text,
    ADD COLUMN IF NOT EXISTS skills_embedding_model text,
    ADD COLUMN IF NOT EXISTS skills_embedded_at timestamptz,
    ADD COLUMN IF NOT EXISTS role_embedding vector(1536),
    ADD COLUMN IF NOT EXISTS role_embedding_hash text,
    ADD COLUMN IF NOT EXISTS role_embedding_model text,
    ADD COLUMN IF NOT EXISTS role_embedded_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_candidate_profiles_skills_embedding
    ON public.candidate_profiles USING hnsw (skills_embedding vector_cosine_ops) WHERE skills_embedding IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_candidate_profiles_role_embedding
    ON public.candidate_profiles USING hnsw (role_embedding vector_cosine_ops) WHERE role_embedding IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_skills_embedding
    ON public.jobs USING hnsw (skills_embedding vector_cosine_ops) WHERE skills_embedding IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_role_embedding
    ON public.jobs USING hnsw (role_embedding vector_cosine_ops) WHERE role_embedding IS NOT NULL;

-- ── 2. Extend the existing invalidation triggers (CREATE OR REPLACE; the triggers already exist) ──
CREATE OR REPLACE FUNCTION public.tg_invalidate_profile_embedding()
RETURNS trigger LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
    IF (NEW.headline, NEW.bio, NEW.skills, NEW.years_experience, NEW.last_role)
       IS DISTINCT FROM
       (OLD.headline, OLD.bio, OLD.skills, OLD.years_experience, OLD.last_role) THEN
        NEW.profile_embedding_hash := NULL;
    END IF;
    IF NEW.skills IS DISTINCT FROM OLD.skills THEN
        NEW.skills_embedding_hash := NULL;
    END IF;
    IF (NEW.headline, NEW.last_role) IS DISTINCT FROM (OLD.headline, OLD.last_role) THEN
        NEW.role_embedding_hash := NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_invalidate_job_embedding()
RETURNS trigger LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
    IF (NEW.title, NEW.category, NEW.skills, NEW.city, NEW.description)
       IS DISTINCT FROM
       (OLD.title, OLD.category, OLD.skills, OLD.city, OLD.description) THEN
        NEW.description_embedding_hash := NULL;
    END IF;
    IF NEW.skills IS DISTINCT FROM OLD.skills THEN
        NEW.skills_embedding_hash := NULL;
    END IF;
    IF (NEW.title, NEW.category) IS DISTINCT FROM (OLD.title, OLD.category) THEN
        NEW.role_embedding_hash := NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_candidate_skills_embedding(
    _embedding vector(1536), _input_hash text DEFAULT NULL, _model text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
    UPDATE public.candidate_profiles
    SET skills_embedding = _embedding, skills_embedding_hash = _input_hash,
        skills_embedding_model = _model, skills_embedded_at = now()
    WHERE user_id = auth.uid();
END;
$$;
REVOKE ALL ON FUNCTION public.update_candidate_skills_embedding(vector, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_candidate_skills_embedding(vector, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_candidate_role_embedding(
    _embedding vector(1536), _input_hash text DEFAULT NULL, _model text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
    UPDATE public.candidate_profiles
    SET role_embedding = _embedding, role_embedding_hash = _input_hash,
        role_embedding_model = _model, role_embedded_at = now()
    WHERE user_id = auth.uid();
END;
$$;
REVOKE ALL ON FUNCTION public.update_candidate_role_embedding(vector, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_candidate_role_embedding(vector, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_job_skills_embedding(
    _job_id uuid, _embedding vector(1536), _input_hash text DEFAULT NULL, _model text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _company_id uuid;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
    SELECT company_id INTO _company_id FROM public.jobs WHERE id = _job_id;
    IF _company_id IS NULL OR NOT public.has_company_membership(auth.uid(), _company_id) THEN
        RAISE EXCEPTION 'insufficient_permissions';
    END IF;
    UPDATE public.jobs
    SET skills_embedding = _embedding, skills_embedding_hash = _input_hash,
        skills_embedding_model = _model, skills_embedded_at = now()
    WHERE id = _job_id;
END;
$$;
REVOKE ALL ON FUNCTION public.update_job_skills_embedding(uuid, vector, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_job_skills_embedding(uuid, vector, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_job_role_embedding(
    _job_id uuid, _embedding vector(1536), _input_hash text DEFAULT NULL, _model text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _company_id uuid;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
    SELECT company_id INTO _company_id FROM public.jobs WHERE id = _job_id;
    IF _company_id IS NULL OR NOT public.has_company_membership(auth.uid(), _company_id) THEN
        RAISE EXCEPTION 'insufficient_permissions';
    END IF;
    UPDATE public.jobs
    SET role_embedding = _embedding, role_embedding_hash = _input_hash,
        role_embedding_model = _model, role_embedded_at = now()
    WHERE id = _job_id;
END;
$$;
REVOKE ALL ON FUNCTION public.update_job_role_embedding(uuid, vector, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_job_role_embedding(uuid, vector, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.candidate_skills_embedding_is_current(_hash text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (SELECT 1 FROM public.candidate_profiles cp WHERE cp.user_id = auth.uid()
        AND cp.skills_embedding IS NOT NULL AND cp.skills_embedding_hash = _hash)
$$;
REVOKE ALL ON FUNCTION public.candidate_skills_embedding_is_current(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.candidate_skills_embedding_is_current(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.candidate_role_embedding_is_current(_hash text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (SELECT 1 FROM public.candidate_profiles cp WHERE cp.user_id = auth.uid()
        AND cp.role_embedding IS NOT NULL AND cp.role_embedding_hash = _hash)
$$;
REVOKE ALL ON FUNCTION public.candidate_role_embedding_is_current(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.candidate_role_embedding_is_current(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.job_skills_embedding_is_current(_job_id uuid, _hash text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = _job_id
        AND public.has_company_membership(auth.uid(), j.company_id)
        AND j.skills_embedding IS NOT NULL AND j.skills_embedding_hash = _hash)
$$;
REVOKE ALL ON FUNCTION public.job_skills_embedding_is_current(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_skills_embedding_is_current(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.job_role_embedding_is_current(_job_id uuid, _hash text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = _job_id
        AND public.has_company_membership(auth.uid(), j.company_id)
        AND j.role_embedding IS NOT NULL AND j.role_embedding_hash = _hash)
$$;
REVOKE ALL ON FUNCTION public.job_role_embedding_is_current(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_role_embedding_is_current(uuid, text) TO authenticated;

-- ── 3. Weights: new columns + relative rebalance (applied once, only when the columns are first added) ──
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'recommendation_settings'
                     AND column_name = 'semantic_skill_weight') THEN
        ALTER TABLE public.recommendation_settings
            ADD COLUMN semantic_skill_weight numeric NOT NULL DEFAULT 0.05,
            ADD COLUMN semantic_role_weight numeric NOT NULL DEFAULT 0.05;
        UPDATE public.recommendation_settings
        SET semantic_weight = GREATEST(semantic_weight - 0.10, 0.02)
        WHERE id = 1;
    END IF;
END $$;

-- ── 4. recommend_jobs_for_candidate: Plan-11 V1 body + faceted semantic components ──
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
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public SET plan_cache_mode = force_custom_plan
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
    _cand_skills_embedding vector(1536);
    _cand_role_embedding vector(1536);
    _cand_years int;
    _exp_salary numeric;
    _month_start timestamptz;
    _is_cold_start boolean;
    _cand_canon_terms text[];
    _fast_path boolean;
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
    SELECT cp.profile_embedding, cp.skills_embedding, cp.role_embedding, cp.years_experience, cp.expected_salary,
           COALESCE((SELECT array_agg(DISTINCT lower(trim(s))) FROM unnest(COALESCE(cp.skills, '{}'::text[])) s WHERE trim(s) <> ''), '{}'::text[]),
           (SELECT array_agg(DISTINCT w) FROM unnest(regexp_split_to_array(lower(COALESCE(cp.last_role, '') || ' ' || COALESCE(cp.headline, '') || ' ' || array_to_string(COALESCE(cp.interested_roles, '{}'::text[]), ' ')), '[^a-z0-9+#.]+')) w
             WHERE length(w) >= 3 AND w <> ALL (ARRAY['and', 'the', 'for', 'with']))
    INTO _cand_embedding, _cand_skills_embedding, _cand_role_embedding, _cand_years, _exp_salary, _cand_skill_text, _role_words
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

    -- A2: resolve the candidate's canonical skill names/aliases to a flat lowercase term array ONCE,
    -- instead of re-querying canonical_skills per job-skill-string inside the scoring CTE (A3).
    SELECT COALESCE(array_agg(DISTINCT t), '{}'::text[]) INTO _cand_canon_terms
    FROM public.canonical_skills cs,
         LATERAL unnest(ARRAY[lower(cs.name)] || COALESCE((SELECT array_agg(lower(a)) FROM unnest(cs.aliases) a), '{}'::text[])) t
    WHERE cs.is_active AND cs.id = ANY(COALESCE(_cand_skill_ids, '{}'::uuid[]));

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

    -- A7: ordering and total_count for an explicit (non-'recommended') sort with _relevant_only not true
    -- do not depend on any score, so only the requested page needs to be scored at all.
    _fast_path := (_sort <> 'recommended' AND _relevant_only IS NOT TRUE);

    RETURN QUERY
    WITH s AS (
        SELECT * FROM public.recommendation_settings rs WHERE rs.id = 1
    ),
    eligible_ids AS MATERIALIZED (
        -- Every hard filter from the original eligible_jobs WHERE clause, written ONCE, slim columns only.
        SELECT j.id, j.created_at, j.min_salary, j.max_salary
        FROM public.jobs j
        JOIN public.companies c ON c.id = j.company_id
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
    chosen AS MATERIALIZED (
        -- All ids when NOT fast path (full scoring needed); only the requested page of ids, pre-ordered by
        -- the same per-sort keys (A8 tiebreak included), when fast path.
        SELECT id FROM eligible_ids
        ORDER BY
            CASE WHEN _fast_path AND _sort = 'newest' THEN created_at END DESC,
            CASE WHEN _fast_path AND _sort = 'oldest' THEN created_at END ASC,
            CASE WHEN _fast_path AND _sort = 'salary_high' THEN max_salary END DESC NULLS LAST,
            CASE WHEN _fast_path AND _sort = 'salary_low' THEN min_salary END ASC NULLS LAST,
            created_at DESC, id
        LIMIT CASE WHEN _fast_path THEN _limit END
        OFFSET CASE WHEN _fast_path THEN _offset ELSE 0 END
    ),
    eligible_jobs AS (
        SELECT
            j.id, j.company_id, j.title, j.city, j.state, j.locality,
            j.min_salary, j.max_salary, j.salary_period,
            j.job_type::text AS job_type, j.work_mode::text AS work_mode,
            j.min_experience_years, j.max_experience_years, j.education, j.skills,
            j.created_at, j.pay_type, j.avg_incentive_monthly,
            c.name AS company_name, c.is_verified AS company_is_verified,
            j.category, j.description_embedding, j.skills_embedding, j.role_embedding,
            lb.ends_at AS boost_ends_at, lb.starts_at AS boost_starts_at,
            (j.tier = 'trending' AND j.created_at >= _month_start) AS is_trending
        FROM public.jobs j
        JOIN chosen ch ON ch.id = j.id
        JOIN public.companies c ON c.id = j.company_id
        LEFT JOIN LATERAL (
            SELECT jb.ends_at, jb.starts_at FROM public.job_boosts jb
            WHERE jb.job_id = j.id AND jb.ends_at > now()
            ORDER BY jb.ends_at DESC LIMIT 1
        ) lb ON true
    ),
    -- A6: only needed to feed cold_start_score/category_has_signal, both forced to 0/false otherwise.
    category_popularity AS (
        SELECT j.category, count(*) AS app_count
        FROM public.applications a
        JOIN public.jobs j ON j.id = a.job_id
        WHERE _is_cold_start AND a.created_at >= now() - interval '30 days'
        GROUP BY j.category
    ),
    category_popularity_bounds AS (
        SELECT COALESCE(MAX(app_count), 0) AS max_app_count FROM category_popularity
    ),
    -- A4: every per-row score computed exactly once, slim explicit column list (no description_embedding,
    -- tier or category carried past this point).
    scored AS MATERIALIZED (
        SELECT
            ej.id, ej.company_id, ej.title, ej.city, ej.state, ej.locality,
            ej.min_salary, ej.max_salary, ej.salary_period,
            ej.job_type, ej.work_mode, ej.min_experience_years, ej.max_experience_years,
            ej.education, ej.skills, ej.created_at, ej.pay_type, ej.avg_incentive_monthly,
            ej.company_name, ej.company_is_verified, ej.boost_ends_at,
            s.skill_weight, s.role_weight, s.location_weight, s.salary_weight, s.experience_weight,
            s.freshness_weight, s.boost_weight, s.trending_weight, s.cold_start_weight, s.semantic_weight,
            s.semantic_skill_weight, s.semantic_role_weight,
            -- A3: skill coverage of the JOB's required skills (0..1) from precomputed term arrays, no
            -- per-job-skill EXISTS subquery against canonical_skills. The canonical branch uses lower(js)
            -- WITHOUT trim, exactly like the original `ILIKE js` did; the free-text branch keeps
            -- lower(trim(js)), unchanged. Duplicates in ej.skills are counted separately, as before.
            CASE WHEN COALESCE(cardinality(ej.skills), 0) = 0 THEN 0.3
                 WHEN COALESCE(cardinality(_cand_skill_ids), 0) = 0 AND COALESCE(cardinality(_cand_skill_text), 0) = 0 THEN 0.1
            ELSE (SELECT (count(*) FILTER (WHERE lower(trim(js)) = ANY(COALESCE(_cand_skill_text, '{}'::text[]))
                                              OR lower(js) = ANY(_cand_canon_terms)))::numeric / cardinality(ej.skills)::numeric
                  FROM unnest(ej.skills) AS js) END::numeric AS skill_score,
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
            ELSE 0.5 END::numeric AS semantic_score,
            -- Faceted semantic components (skills-only / role-only embeddings). Neutral 0.5 whenever
            -- either side lacks that facet's embedding (e.g. before backfill), like semantic_score.
            CASE WHEN _cand_skills_embedding IS NOT NULL AND ej.skills_embedding IS NOT NULL THEN
                GREATEST(0, LEAST(1, (1 - (ej.skills_embedding <=> _cand_skills_embedding))::numeric))
            ELSE 0.5 END::numeric AS semantic_skill_score,
            CASE WHEN _cand_role_embedding IS NOT NULL AND ej.role_embedding IS NOT NULL THEN
                GREATEST(0, LEAST(1, (1 - (ej.role_embedding <=> _cand_role_embedding))::numeric))
            ELSE 0.5 END::numeric AS semantic_role_score
        FROM eligible_jobs ej
        CROSS JOIN s
        CROSS JOIN category_popularity_bounds cpb
        LEFT JOIN category_popularity cp ON cp.category = ej.category
    ),
    -- A5: final_score and company_rank computed over ALL rows of "scored" (i.e. before the relevance
    -- gate), exactly as before.
    ranked AS (
        SELECT sc.*,
            LEAST(1, GREATEST(0,
                sc.skill_score * sc.skill_weight + sc.role_score * sc.role_weight +
                sc.location_score * sc.location_weight + sc.salary_score * sc.salary_weight +
                sc.experience_score * sc.experience_weight + sc.freshness_score * sc.freshness_weight +
                sc.boost_score * sc.boost_weight + sc.trending_score * sc.trending_weight +
                sc.cold_start_score * sc.cold_start_weight + sc.semantic_score * sc.semantic_weight +
                sc.semantic_skill_score * sc.semantic_skill_weight + sc.semantic_role_score * sc.semantic_role_weight
            )) AS final_score,
            ROW_NUMBER() OVER (PARTITION BY sc.company_id ORDER BY
                sc.skill_score * sc.skill_weight + sc.role_score * sc.role_weight +
                sc.location_score * sc.location_weight + sc.salary_score * sc.salary_weight +
                sc.experience_score * sc.experience_weight + sc.freshness_score * sc.freshness_weight +
                sc.boost_score * sc.boost_weight + sc.trending_score * sc.trending_weight +
                sc.cold_start_score * sc.cold_start_weight + sc.semantic_score * sc.semantic_weight +
                sc.semantic_skill_score * sc.semantic_skill_weight + sc.semantic_role_score * sc.semantic_role_weight DESC
            ) AS company_rank
        FROM scored sc
    ),
    page AS (
        SELECT r.*,
            CASE WHEN _fast_path THEN (SELECT count(*) FROM eligible_ids) ELSE count(*) OVER() END AS total_count
        FROM ranked r
        CROSS JOIN s
        -- Relevance gate: a department match (role 1.0 or neighbouring 0.75) counts,
        -- as does a real skill, title or semantic fit. Cold start is the only bypass.
        -- Applies regardless of sort — "Newest"/"Salary high" etc. still only show
        -- jobs relevant to the candidate, they just reorder within that set.
        WHERE (
            _relevant_only IS NOT TRUE OR _is_cold_start OR
            r.skill_score >= s.relevant_skill_threshold OR
            r.role_score >= s.relevant_role_threshold OR
            r.semantic_score >= s.relevant_semantic_threshold
        )
        ORDER BY
            -- Exactly one of these CASE expressions is non-null for every row (the one matching _sort);
            -- the rest evaluate to NULL for every row and so contribute no ordering, falling through to
            -- the next column. A8: created_at DESC, id is the final deterministic tiebreak.
            CASE WHEN _sort = 'recommended' THEN (r.company_rank > s.max_same_company_in_top) END ASC,
            CASE WHEN _sort = 'recommended' THEN r.final_score END DESC,
            CASE WHEN _sort = 'newest' THEN r.created_at END DESC,
            CASE WHEN _sort = 'oldest' THEN r.created_at END ASC,
            CASE WHEN _sort = 'salary_high' THEN r.max_salary END DESC NULLS LAST,
            CASE WHEN _sort = 'salary_low' THEN r.min_salary END ASC NULLS LAST,
            r.created_at DESC, r.id
        -- A7: the fast path already selected the requested page inside "chosen"; OFFSET is 0 here so it
        -- is not skipped a second time. Otherwise behaves exactly as before.
        LIMIT _limit OFFSET CASE WHEN _fast_path THEN 0 ELSE _offset END
    )
    SELECT
        p.id, p.company_id, p.title, p.city, p.state, p.locality,
        p.min_salary, p.max_salary, p.salary_period, p.job_type, p.work_mode,
        p.min_experience_years, p.max_experience_years, p.education, p.skills,
        p.created_at, p.pay_type, p.avg_incentive_monthly, p.company_name, p.company_is_verified,
        (p.boost_ends_at IS NOT NULL) AS boosted,
        round(p.final_score::numeric, 4) AS score,
        jsonb_build_object(
            'skill', round(p.skill_score * 100) / 100.0,
            'role', round(p.role_score * 100) / 100.0,
            'location', round(p.location_score * 100) / 100.0,
            'salary', round(p.salary_score * 100) / 100.0,
            'experience', round(p.experience_score * 100) / 100.0,
            'freshness', round(p.freshness_score * 100) / 100.0,
            'boost', round(p.boost_score * 100) / 100.0,
            'trending', round(p.trending_score * 100) / 100.0,
            'cold_start', round(p.cold_start_score * 100) / 100.0,
            'semantic', round(p.semantic_score * 100) / 100.0,
            'semantic_skill', round(p.semantic_skill_score * 100) / 100.0,
            'semantic_role', round(p.semantic_role_score * 100) / 100.0,
            'weights', jsonb_build_object(
                'skill', p.skill_weight, 'role', p.role_weight, 'location', p.location_weight,
                'salary', p.salary_weight, 'experience', p.experience_weight,
                'freshness', p.freshness_weight, 'boost', p.boost_weight,
                'trending', p.trending_weight, 'cold_start', p.cold_start_weight,
                'semantic', p.semantic_weight, 'semantic_skill', p.semantic_skill_weight,
                'semantic_role', p.semantic_role_weight
            )
        ) AS score_breakdown,
        CASE
            WHEN NOT _is_cold_start THEN 'personalized'
            WHEN p.category_has_signal THEN 'popular_in_category'
            ELSE 'citywide_fresh'
        END AS recommendation_stage,
        p.total_count
    FROM page p
    -- Same ORDER BY repeated: CTE row order is not guaranteed without it, and this is the order actually
    -- returned to the caller.
    ORDER BY
        CASE WHEN _sort = 'recommended' THEN (p.company_rank > (SELECT max_same_company_in_top FROM s)) END ASC,
        CASE WHEN _sort = 'recommended' THEN p.final_score END DESC,
        CASE WHEN _sort = 'newest' THEN p.created_at END DESC,
        CASE WHEN _sort = 'oldest' THEN p.created_at END ASC,
        CASE WHEN _sort = 'salary_high' THEN p.max_salary END DESC NULLS LAST,
        CASE WHEN _sort = 'salary_low' THEN p.min_salary END ASC NULLS LAST,
        p.created_at DESC, p.id;
END;
$$;

REVOKE ALL ON FUNCTION public.recommend_jobs_for_candidate(
    int, int, text, text, text, text, text, int, int, int, int, timestamptz, text, text, text, text, boolean, boolean, boolean, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recommend_jobs_for_candidate(
    int, int, text, text, text, text, text, int, int, int, int, timestamptz, text, text, text, text, boolean, boolean, boolean, text
) TO authenticated;
