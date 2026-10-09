-- ============================================================
-- Recommendation V2: behavior-aware re-ranker over V1's top window
-- ============================================================
-- V1 (recommend_jobs_for_candidate) is untouched and remains the fallback.
-- V2 only REORDERS V1's top window; it never filters or adds jobs. The visible
-- match % (score) is V1's; ordering uses rank_score. Controlled by
-- recommendation_settings: kill switch, allowlist, % rollout. Re-runnable.

-- ── A. Pure helpers ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recommendation_event_strength(_weight numeric, _age_days numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
    SELECT _weight * power(0.5::numeric, GREATEST(_age_days, 0::numeric) / 3.5::numeric)
$$;

CREATE OR REPLACE FUNCTION public.recommendation_blend(
    _base numeric, _intent numeric, _similar numeric,
    _w_intent numeric, _w_similar numeric, _fatigued boolean, _fatigue_mult numeric
) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
    SELECT LEAST(1::numeric, GREATEST(0::numeric,
        ((1 - _w_intent - _w_similar) * _base + _w_intent * _intent + _w_similar * _similar)
        * CASE WHEN _fatigued THEN _fatigue_mult ELSE 1::numeric END))
$$;

-- Debug/analytics labels (no UI). Thresholds are descriptive, not scoring inputs.
CREATE OR REPLACE FUNCTION public.recommendation_reason_codes(
    _breakdown jsonb, _intent numeric, _similar numeric, _fatigued boolean
) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
    SELECT array_remove(ARRAY[
        CASE WHEN COALESCE((_breakdown->>'skill')::numeric, 0)      >= 0.5  THEN 'SKILL_MATCH'      END,
        CASE WHEN COALESCE((_breakdown->>'role')::numeric, 0)       >= 0.75 THEN 'ROLE_MATCH'       END,
        CASE WHEN COALESCE((_breakdown->>'experience')::numeric, 0) >= 0.8  THEN 'EXPERIENCE_MATCH' END,
        CASE WHEN COALESCE((_breakdown->>'location')::numeric, 0)   >= 1    THEN 'LOCATION_MATCH'   END,
        CASE WHEN COALESCE((_breakdown->>'salary')::numeric, 0)     >= 0.8  THEN 'SALARY_MATCH'     END,
        CASE WHEN COALESCE((_breakdown->>'semantic')::numeric, 0)   >= 0.7  THEN 'SEMANTIC_MATCH'   END,
        CASE WHEN COALESCE((_breakdown->>'freshness')::numeric, 0)  >= 0.8  THEN 'FRESHNESS'        END,
        CASE WHEN _intent  >= 0.25 THEN 'RECENT_INTENT' END,
        CASE WHEN _similar >= 0.25 THEN 'SIMILAR_JOB'   END,
        CASE WHEN _fatigued        THEN 'REPEAT_EXPOSURE_DEMOTED' END
    ]::text[], NULL)
$$;

-- Deterministic 0..99 bucket for percentage rollout (stable per user + salt).
CREATE OR REPLACE FUNCTION public.recommendation_bucket(_uid uuid, _salt text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
    SELECT ((hashtextextended(_uid::text || _salt, 0) & 2147483647) % 100)::int
$$;

-- ── B. Settings + rollout flag ──────────────────────────────
ALTER TABLE public.recommendation_settings
    ADD COLUMN IF NOT EXISTS v2_enabled boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS v2_rollout_pct int NOT NULL DEFAULT 0
        CHECK (v2_rollout_pct BETWEEN 0 AND 100),
    ADD COLUMN IF NOT EXISTS v2_salt text NOT NULL DEFAULT 'jk-rec-v2',
    ADD COLUMN IF NOT EXISTS v2_allowlist uuid[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS v2_window int NOT NULL DEFAULT 140
        CHECK (v2_window BETWEEN 28 AND 300),
    ADD COLUMN IF NOT EXISTS v2_intent_weight numeric NOT NULL DEFAULT 0.10
        CHECK (v2_intent_weight BETWEEN 0 AND 0.4),
    ADD COLUMN IF NOT EXISTS v2_similarity_weight numeric NOT NULL DEFAULT 0.15
        CHECK (v2_similarity_weight BETWEEN 0 AND 0.4),
    ADD COLUMN IF NOT EXISTS v2_fatigue_min_days int NOT NULL DEFAULT 3
        CHECK (v2_fatigue_min_days BETWEEN 2 AND 7),
    ADD COLUMN IF NOT EXISTS v2_fatigue_multiplier numeric NOT NULL DEFAULT 0.85
        CHECK (v2_fatigue_multiplier BETWEEN 0.5 AND 1);

-- Kill switch first, then allowlist (staff dogfooding), then percentage bucket.
CREATE OR REPLACE FUNCTION public.recommendation_v2_active(_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT COALESCE((
        SELECT rs.v2_enabled
               AND (_uid = ANY(rs.v2_allowlist)
                    OR public.recommendation_bucket(_uid, rs.v2_salt) < rs.v2_rollout_pct)
        FROM public.recommendation_settings rs
        WHERE rs.id = 1
    ), false)
$$;

REVOKE ALL ON FUNCTION public.recommendation_v2_active(uuid) FROM PUBLIC, anon, authenticated;

-- ── C. Re-ranker ────────────────────────────────────────────
-- Input: V1's top window (already filtered/gated/diversified by V1).
-- Output: the same rows, re-ordered.
--   rank = clamp( (1-wI-wS)*V1score + wI*intent + wS*similarity ) * (fatigued ? mult : 1)
--   intent     = strongest recent engagement (view .4 / save .8 / apply 1.0, 3.5-day
--                half-life, 14-day window) on a DIFFERENT job in the same category
--   similarity = strongest (engagement strength × pgvector cosine) to a DIFFERENT engaged job
--   fatigued   = shown on >= v2_fatigue_min_days distinct IST days in 7 days AND never
--                viewed/saved/applied (counts distinct DAYS, so refetch noise cannot demote)
-- No engagement events => intent/similarity weights forced to 0 => V1 order (+ fatigue only).
CREATE OR REPLACE FUNCTION public.recommendation_rerank(_uid uuid, _rows public.job_feed_row[])
RETURNS public.job_feed_row[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
    _s public.recommendation_settings%ROWTYPE;
    _out public.job_feed_row[];
BEGIN
    IF _rows IS NULL OR cardinality(_rows) = 0 THEN
        RETURN _rows;
    END IF;

    SELECT * INTO _s FROM public.recommendation_settings WHERE id = 1;

    WITH win AS (
        SELECT u.id, u.company_id, u.title, u.city, u.state, u.locality,
               u.min_salary, u.max_salary, u.salary_period, u.job_type, u.work_mode,
               u.min_experience_years, u.max_experience_years, u.education, u.skills,
               u.created_at, u.pay_type, u.avg_incentive_monthly, u.company_name, u.company_is_verified,
               u.boosted, u.score, u.score_breakdown, u.recommendation_stage, u.total_count, u.request_id
        FROM unnest(_rows) AS u
    ),
    ev_raw AS (
        SELECT f.job_id, 0.4::numeric AS w, f.created_at AS at
        FROM public.job_recommendation_feedback f
        WHERE f.candidate_user_id = _uid AND f.action = 'viewed'
          AND f.created_at > now() - interval '14 days'
        UNION ALL
        SELECT sj.job_id, 0.8::numeric, sj.created_at
        FROM public.saved_jobs sj
        WHERE sj.user_id = _uid AND sj.created_at > now() - interval '14 days'
        UNION ALL
        SELECT a.job_id, 1.0::numeric, a.created_at
        FROM public.applications a
        WHERE a.candidate_id = _uid AND a.created_at > now() - interval '14 days'
    ),
    ev AS (
        SELECT DISTINCT ON (r.job_id) r.job_id,
               public.recommendation_event_strength(
                   r.w, (extract(epoch FROM (now() - r.at)) / 86400.0)::numeric) AS strength
        FROM ev_raw r
        ORDER BY r.job_id,
                 public.recommendation_event_strength(
                     r.w, (extract(epoch FROM (now() - r.at)) / 86400.0)::numeric) DESC
    ),
    ev_top AS (
        SELECT e.job_id, e.strength, j.category, j.description_embedding
        FROM ev e
        JOIN public.jobs j ON j.id = e.job_id
        ORDER BY e.strength DESC
        LIMIT 30
    ),
    ev_n AS (
        SELECT count(*)::int AS n FROM ev_top
    ),
    engaged AS (
        SELECT f.job_id FROM public.job_recommendation_feedback f
        WHERE f.candidate_user_id = _uid AND f.action IN ('viewed', 'saved', 'applied')
        UNION
        SELECT sj.job_id FROM public.saved_jobs sj WHERE sj.user_id = _uid
        UNION
        SELECT a.job_id FROM public.applications a WHERE a.candidate_id = _uid
    ),
    fatigued_jobs AS (
        SELECT i.job_id
        FROM public.job_impressions i
        WHERE i.candidate_user_id = _uid
          AND i.shown_at > now() - interval '7 days'
          AND i.job_id IN (SELECT w.id FROM win w)
          AND i.job_id NOT IN (SELECT e.job_id FROM engaged e)
        GROUP BY i.job_id
        HAVING count(DISTINCT (i.shown_at AT TIME ZONE 'Asia/Kolkata')::date) >= _s.v2_fatigue_min_days
    ),
    sig AS (
        SELECT w.*,
               COALESCE((
                   SELECT max(e.strength) FROM ev_top e
                   WHERE e.job_id <> w.id AND e.category IS NOT NULL AND e.category = jj.category
               ), 0)::numeric AS intent_score,
               COALESCE((
                   SELECT max(e.strength * GREATEST(0::numeric, LEAST(1::numeric,
                              (1 - (e.description_embedding <=> jj.description_embedding))::numeric)))
                   FROM ev_top e
                   WHERE e.job_id <> w.id
                     AND e.description_embedding IS NOT NULL
                     AND jj.description_embedding IS NOT NULL
               ), 0)::numeric AS similarity_score,
               (w.id IN (SELECT fj.job_id FROM fatigued_jobs fj)) AS fatigued
        FROM win w
        JOIN public.jobs jj ON jj.id = w.id
    ),
    ranked AS (
        SELECT s.*,
               public.recommendation_blend(
                   s.score, s.intent_score, s.similarity_score,
                   CASE WHEN en.n = 0 THEN 0::numeric ELSE _s.v2_intent_weight END,
                   CASE WHEN en.n = 0 THEN 0::numeric ELSE _s.v2_similarity_weight END,
                   s.fatigued, _s.v2_fatigue_multiplier
               ) AS rank_score
        FROM sig s
        CROSS JOIN ev_n en
    ),
    ordered AS (
        SELECT r.*,
               row_number() OVER (
                   PARTITION BY r.company_id ORDER BY r.rank_score DESC, r.created_at DESC
               ) AS company_rank
        FROM ranked r
    )
    SELECT array_agg(
               ROW(o.id, o.company_id, o.title, o.city, o.state, o.locality,
                   o.min_salary, o.max_salary, o.salary_period, o.job_type, o.work_mode,
                   o.min_experience_years, o.max_experience_years, o.education, o.skills,
                   o.created_at, o.pay_type, o.avg_incentive_monthly, o.company_name, o.company_is_verified,
                   o.boosted, o.score, o.score_breakdown, o.recommendation_stage, o.total_count,
                   o.request_id, 'v2'::text, round(o.rank_score, 4),
                   public.recommendation_reason_codes(o.score_breakdown, o.intent_score, o.similarity_score, o.fatigued),
                   COALESCE(o.score_breakdown - 'weights', '{}'::jsonb)
                       || jsonb_build_object('intent', round(o.intent_score, 3),
                                             'similarity', round(o.similarity_score, 3),
                                             'fatigued', o.fatigued)
               )::public.job_feed_row
               -- same diversity rule V1 uses: a company's extra jobs sink below others
               ORDER BY (o.company_rank > _s.max_same_company_in_top) ASC,
                        o.rank_score DESC, o.created_at DESC
           )
    INTO _out
    FROM ordered o;

    RETURN _out;
END;
$$;

REVOKE ALL ON FUNCTION public.recommendation_rerank(uuid, public.job_feed_row[])
    FROM PUBLIC, anon, authenticated;

-- ── D. Router: arm assignment + V2 branch + automatic V1 fallback ─
-- Replaces Plan 1's recommend_jobs_routed (same 21-param signature). With
-- v2_enabled = false it is behaviorally identical to Plan 1's router.
-- variant = the user's ARM for every row they receive (intention-to-treat),
-- including explicit-sort pages, window-tail rows and V2_FALLBACK rows.
CREATE OR REPLACE FUNCTION public.recommend_jobs_routed(
    _limit int DEFAULT 20, _offset int DEFAULT 0, _q text DEFAULT NULL,
    _city text DEFAULT NULL, _category text DEFAULT NULL, _job_type text DEFAULT NULL,
    _work_mode text DEFAULT NULL, _min_salary int DEFAULT NULL, _max_salary int DEFAULT NULL,
    _min_exp int DEFAULT NULL, _max_exp int DEFAULT NULL, _posted_after timestamptz DEFAULT NULL,
    _education text DEFAULT NULL, _shift text DEFAULT NULL, _english_level text DEFAULT NULL,
    _company text DEFAULT NULL, _vehicle boolean DEFAULT false, _verified_only boolean DEFAULT false,
    _relevant_only boolean DEFAULT false, _sort text DEFAULT 'recommended',
    _surface text DEFAULT 'browse'
) RETURNS SETOF public.job_feed_row
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
    _uid uuid := auth.uid();
    _request_id uuid := gen_random_uuid();
    _s public.recommendation_settings%ROWTYPE;
    _sort_norm text;
    _source text;
    _arm text := 'v1';
    _use_v2 boolean := false;
    _fallback boolean := false;
    _rows public.job_feed_row[];
    _window_rows public.job_feed_row[];
    _tail public.job_feed_row[];
BEGIN
    IF _uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated';
    END IF;

    _sort_norm := CASE
        WHEN _sort IN ('recommended', 'newest', 'oldest', 'salary_high', 'salary_low') THEN _sort
        ELSE 'recommended' END;
    _source := CASE
        WHEN _surface = 'dashboard' THEN 'recommended'
        WHEN NULLIF(btrim(COALESCE(_q, '')), '') IS NOT NULL THEN 'search'
        ELSE 'browse' END;

    SELECT * INTO _s FROM public.recommendation_settings WHERE id = 1;

    -- A broken flag lookup must never take the feed down.
    BEGIN
        IF public.recommendation_v2_active(_uid) THEN _arm := 'v2'; END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'recommend_jobs_routed: arm lookup failed, serving v1: %', SQLERRM;
        _arm := 'v1';
    END;

    -- V2 only re-ranks the default relevance ordering, inside its window.
    -- Explicit sorts, and pages entirely beyond the window, are plain V1.
    _use_v2 := COALESCE(_arm = 'v2' AND _sort_norm = 'recommended' AND _offset < _s.v2_window, false);

    IF _use_v2 THEN
        BEGIN
            _window_rows := ARRAY(
                SELECT r FROM public.recommendation_fetch_v1(
                    'v2', _request_id, NULL::text[],
                    _s.v2_window, 0, _q, _city, _category, _job_type, _work_mode,
                    _min_salary, _max_salary, _min_exp, _max_exp, _posted_after,
                    _education, _shift, _english_level, _company,
                    _vehicle, _verified_only, _relevant_only, 'recommended'
                ) AS r
            );
            -- Slicing past the end (or a NULL/empty array) yields an empty/NULL page, never an error.
            _rows := (public.recommendation_rerank(_uid, _window_rows))[_offset + 1 : _offset + _limit];

            -- A page that straddles the window edge continues in V1 order right after it.
            IF _offset + _limit > _s.v2_window THEN
                _tail := ARRAY(
                    SELECT r FROM public.recommendation_fetch_v1(
                        'v2', _request_id, NULL::text[],
                        _offset + _limit - _s.v2_window, _s.v2_window, _q, _city, _category, _job_type, _work_mode,
                        _min_salary, _max_salary, _min_exp, _max_exp, _posted_after,
                        _education, _shift, _english_level, _company,
                        _vehicle, _verified_only, _relevant_only, 'recommended'
                    ) AS r
                );
                _rows := COALESCE(_rows, ARRAY[]::public.job_feed_row[])
                      || COALESCE(_tail, ARRAY[]::public.job_feed_row[]);
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'recommend_jobs_routed: v2 failed, serving v1: %', SQLERRM;
            _use_v2 := false;
            _fallback := true;
            _rows := NULL;
        END;
    END IF;

    IF NOT _use_v2 THEN
        _rows := ARRAY(
            SELECT r FROM public.recommendation_fetch_v1(
                _arm, _request_id,
                CASE WHEN _fallback THEN ARRAY['V2_FALLBACK']::text[] ELSE NULL::text[] END,
                _limit, _offset, _q, _city, _category, _job_type, _work_mode,
                _min_salary, _max_salary, _min_exp, _max_exp, _posted_after,
                _education, _shift, _english_level, _company,
                _vehicle, _verified_only, _relevant_only, _sort_norm
            ) AS r
        );
    END IF;

    IF COALESCE(cardinality(_rows), 0) = 0 THEN
        RETURN;
    END IF;

    -- Best-effort logging (as the Plan 1 router): never fails the feed.
    IF EXISTS (SELECT 1 FROM public.candidate_profiles cp WHERE cp.user_id = _uid) THEN
        BEGIN
            INSERT INTO public.job_impressions (
                candidate_user_id, job_id, source, "position", request_id, variant,
                score, rank_score, recommendation_stage, sort, relevant_only,
                reason_codes, features
            )
            SELECT _uid, u.id, _source, (_offset + u.ordinality - 1)::int, _request_id, u.variant,
                   u.score, u.rank_score, u.recommendation_stage, _sort_norm, _relevant_only,
                   u.reason_codes, COALESCE(u.features, u.score_breakdown - 'weights')
            FROM unnest(_rows) WITH ORDINALITY AS u
            WHERE NOT EXISTS (
                -- burst guard (double fetch / retry): same job, same sort, SAME SURFACE
                -- (source) and filter mode, last 10 s. Two tabs/surfaces never suppress each other.
                SELECT 1 FROM public.job_impressions x
                WHERE x.candidate_user_id = _uid AND x.job_id = u.id
                  AND x.sort = _sort_norm
                  AND x.source = _source
                  AND x.relevant_only IS NOT DISTINCT FROM _relevant_only
                  AND x.shown_at > now() - interval '10 seconds'
            );
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'recommend_jobs_routed: impression logging failed: %', SQLERRM;
        END;
    END IF;

    RETURN QUERY SELECT * FROM unnest(_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.recommend_jobs_routed(
    int, int, text, text, text, text, text, int, int, int, int, timestamptz,
    text, text, text, text, boolean, boolean, boolean, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recommend_jobs_routed(
    int, int, text, text, text, text, text, int, int, int, int, timestamptz,
    text, text, text, text, boolean, boolean, boolean, text, text
) TO authenticated;
