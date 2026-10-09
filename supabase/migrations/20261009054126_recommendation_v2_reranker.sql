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
