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
