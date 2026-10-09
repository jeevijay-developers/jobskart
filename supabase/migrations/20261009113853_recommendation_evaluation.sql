-- ============================================================
-- Recommendation evaluation: metrics, labelled impressions, admin readouts
-- ============================================================
-- Read-only analytics over job_impressions and the feedback/saved/applications
-- tables. Labels: viewed / saved / applied by the same candidate on the same job
-- within 24 h after the impression; computed only for impressions older than 24 h.
-- Nothing here writes data or changes feed behaviour.

-- ── A. Pure metrics ─────────────────────────────────────────
-- Gains are given in DISPLAYED order. Returns NULL when the list has no positive
-- gain (undefined NDCG; callers exclude it from means).
CREATE OR REPLACE FUNCTION public.recommendation_ndcg(_gains numeric[], _k int DEFAULT 10)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
    WITH shown AS (
        SELECT g.gain, g.pos
        FROM unnest(_gains) WITH ORDINALITY AS g(gain, pos)
        WHERE g.pos <= _k
    ),
    dcg AS (
        SELECT COALESCE(sum(s.gain / (ln((s.pos + 1)::numeric) / ln(2::numeric))), 0) AS v FROM shown s
    ),
    ideal_sorted AS (
        SELECT g.gain, row_number() OVER (ORDER BY g.gain DESC) AS pos
        FROM unnest(_gains) AS g(gain)
    ),
    idcg AS (
        SELECT COALESCE(sum(i.gain / (ln((i.pos + 1)::numeric) / ln(2::numeric))), 0) AS v
        FROM ideal_sorted i WHERE i.pos <= _k
    )
    SELECT CASE WHEN (SELECT v FROM idcg) = 0 THEN NULL
                ELSE (SELECT v FROM dcg) / (SELECT v FROM idcg) END
$$;

-- z of (arm 2 - arm 1) under a pooled two-proportion test. NULL for empty arms,
-- missing counts, or a degenerate pooled rate (0 or 1).
CREATE OR REPLACE FUNCTION public.recommendation_two_prop_z(_x2 bigint, _n2 bigint, _x1 bigint, _n1 bigint)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    _p numeric;
    _se numeric;
BEGIN
    IF COALESCE(_n1, 0) = 0 OR COALESCE(_n2, 0) = 0 OR _x1 IS NULL OR _x2 IS NULL THEN
        RETURN NULL;
    END IF;
    _p := (_x1 + _x2)::numeric / (_n1 + _n2);
    IF _p = 0 OR _p = 1 THEN
        RETURN NULL;
    END IF;
    _se := sqrt(_p * (1 - _p) * (1.0 / _n1 + 1.0 / _n2));
    RETURN ((_x2::numeric / _n2) - (_x1::numeric / _n1)) / _se;
END;
$$;

-- ── B. Labelled impressions (internal; NOT granted to any client role) ──
-- One row per impression, labelled from actions by the same candidate on the
-- same job within 24 h after shown_at. Only matured impressions (> 24 h old).
-- gain: applied 3, saved 2, viewed 1, none 0 (the NDCG relevance grade).
CREATE OR REPLACE VIEW public.recommendation_labelled_impressions AS
SELECT l.*,
       CASE WHEN l.label_applied THEN 3
            WHEN l.label_saved   THEN 2
            WHEN l.label_viewed  THEN 1
            ELSE 0 END AS gain
FROM (
    SELECT i.id, i.candidate_user_id, i.job_id, i.request_id, i.variant,
           i."position" AS pos, i.shown_at,
           (i.shown_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
           i.source, i.sort, i.relevant_only, i.score, i.rank_score,
           i.recommendation_stage, i.reason_codes, i.features, i.feature_version,
           EXISTS (SELECT 1 FROM public.job_recommendation_feedback x
                   WHERE x.candidate_user_id = i.candidate_user_id AND x.job_id = i.job_id
                     AND x.action = 'viewed'
                     AND x.created_at >= i.shown_at
                     AND x.created_at <  i.shown_at + interval '24 hours') AS label_viewed,
           EXISTS (SELECT 1 FROM public.saved_jobs x
                   WHERE x.user_id = i.candidate_user_id AND x.job_id = i.job_id
                     AND x.created_at >= i.shown_at
                     AND x.created_at <  i.shown_at + interval '24 hours') AS label_saved,
           EXISTS (SELECT 1 FROM public.applications x
                   WHERE x.candidate_id = i.candidate_user_id AND x.job_id = i.job_id
                     AND x.created_at >= i.shown_at
                     AND x.created_at <  i.shown_at + interval '24 hours') AS label_applied
    FROM public.job_impressions i
    WHERE i.request_id IS NOT NULL
      AND i.shown_at < now() - interval '24 hours'
) l;

REVOKE ALL ON public.recommendation_labelled_impressions FROM PUBLIC, anon, authenticated;

-- ── C. A/B readout (platform admins only) ───────────────────
-- Population: sort = 'recommended' only (explicit sorts are plain V1 for everyone),
-- matured impressions, staff in recommendation_settings.v2_allowlist excluded.
-- Each candidate is counted under ONE arm: the arm of their first impression in
-- the window (the randomisation unit is the candidate; a candidate who flipped
-- arms mid-window would otherwise sit in both samples).
-- Rates use the FIRST impression per (candidate, job, IST day), so refetch
-- duplicates do not inflate exposure. NDCG@10 uses each candidate's first
-- page-1 list per IST day; lists with no positive gain are excluded.
-- z compares V2 vs V1 on the candidate apply rate (two-proportion, pooled).
CREATE OR REPLACE FUNCTION public.recommendation_eval(_days int DEFAULT 14)
RETURNS TABLE (
    variant text, n_candidates bigint, n_impressions bigint,
    n_viewed bigint, n_saved bigint, n_applied bigint,
    view_rate numeric, save_rate numeric, apply_rate numeric,
    n_candidates_applied bigint, candidate_apply_rate numeric,
    n_lists bigint, ndcg10 numeric, n_fallback_requests bigint,
    z_candidate_apply_vs_v1 numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
    IF NOT public.has_platform_role(auth.uid(), 'super_admin') THEN
        RAISE EXCEPTION 'insufficient_permissions';
    END IF;

    RETURN QUERY
    WITH staff AS (
        SELECT u.uid
        FROM public.recommendation_settings rs
        CROSS JOIN LATERAL unnest(rs.v2_allowlist) AS u(uid)
        WHERE rs.id = 1
    ),
    population AS (
        SELECT l.*
        FROM public.recommendation_labelled_impressions l
        WHERE l.sort = 'recommended'
          AND l.shown_at >= now() - make_interval(days => _days)
          AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.uid = l.candidate_user_id)
    ),
    arm_of AS (
        SELECT DISTINCT ON (p.candidate_user_id) p.candidate_user_id, p.variant
        FROM population p
        ORDER BY p.candidate_user_id, p.shown_at
    ),
    base AS (
        SELECT p.*
        FROM population p
        JOIN arm_of a ON a.candidate_user_id = p.candidate_user_id AND a.variant = p.variant
    ),
    first_imp AS (
        SELECT DISTINCT ON (b.candidate_user_id, b.job_id, b.day) b.*
        FROM base b
        ORDER BY b.candidate_user_id, b.job_id, b.day, b.shown_at
    ),
    m AS (
        SELECT f.variant AS v,
               count(DISTINCT f.candidate_user_id) AS cands,
               count(*) AS imps,
               count(*) FILTER (WHERE f.label_viewed)  AS nv,
               count(*) FILTER (WHERE f.label_saved)   AS ns,
               count(*) FILTER (WHERE f.label_applied) AS na,
               count(DISTINCT f.candidate_user_id) FILTER (WHERE f.label_applied) AS cands_applied
        FROM first_imp f
        GROUP BY f.variant
    ),
    list_first AS (
        SELECT DISTINCT ON (b.candidate_user_id, b.day)
               b.candidate_user_id, b.day, b.variant, b.request_id
        FROM base b
        WHERE b.pos = 0
        ORDER BY b.candidate_user_id, b.day, b.shown_at
    ),
    list_ndcg AS (
        SELECT lf.variant AS v,
               public.recommendation_ndcg(array_agg(b.gain::numeric ORDER BY b.pos), 10) AS ndcg
        FROM list_first lf
        JOIN base b ON b.request_id = lf.request_id
        GROUP BY lf.variant, lf.candidate_user_id, lf.day
    ),
    n AS (
        SELECT ln.v, count(*) AS lists, avg(ln.ndcg) AS ndcg10
        FROM list_ndcg ln
        WHERE ln.ndcg IS NOT NULL
        GROUP BY ln.v
    ),
    fb AS (
        SELECT i.variant AS v, count(DISTINCT i.request_id) AS nfb
        FROM public.job_impressions i
        WHERE 'V2_FALLBACK' = ANY(COALESCE(i.reason_codes, ARRAY[]::text[]))
          AND i.sort = 'recommended'
          AND i.shown_at >= now() - make_interval(days => _days)
          AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.uid = i.candidate_user_id)
          AND EXISTS (SELECT 1 FROM arm_of a
                      WHERE a.candidate_user_id = i.candidate_user_id AND a.variant = i.variant)
        GROUP BY i.variant
    )
    SELECT m.v, m.cands, m.imps, m.nv, m.ns, m.na,
           round(m.nv::numeric / NULLIF(m.imps, 0), 4),
           round(m.ns::numeric / NULLIF(m.imps, 0), 4),
           round(m.na::numeric / NULLIF(m.imps, 0), 4),
           m.cands_applied,
           round(m.cands_applied::numeric / NULLIF(m.cands, 0), 4),
           COALESCE(n.lists, 0::bigint),
           round(n.ndcg10, 4),
           COALESCE(fb.nfb, 0::bigint),
           CASE WHEN m.v = 'v2'
                THEN public.recommendation_two_prop_z(m.cands_applied, m.cands, c1.cands_applied, c1.cands)
           END
    FROM m
    LEFT JOIN n  ON n.v  = m.v
    LEFT JOIN fb ON fb.v = m.v
    LEFT JOIN m c1 ON c1.v = 'v1'
    ORDER BY m.v;
END;
$$;

REVOKE ALL ON FUNCTION public.recommendation_eval(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recommendation_eval(int) TO authenticated;

-- ── D. Data health (platform admins only; gate G1) ──────────
-- Counts every impression in the window, labelled or not (no maturity filter),
-- so the dashboard shows traffic as it arrives. V2 fallback rate is measured per
-- request: a request is a fallback when V2 failed and V1 served it
-- (reason_codes carries 'V2_FALLBACK'; the variant stays the arm, intention-to-treat).
CREATE OR REPLACE FUNCTION public.recommendation_data_health(_days int DEFAULT 14)
RETURNS TABLE (metric text, value numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
    IF NOT public.has_platform_role(auth.uid(), 'super_admin') THEN
        RAISE EXCEPTION 'insufficient_permissions';
    END IF;

    RETURN QUERY
    WITH imp AS (
        SELECT i.* FROM public.job_impressions i
        WHERE i.shown_at >= now() - make_interval(days => _days) AND i.request_id IS NOT NULL
    ),
    req AS (
        SELECT i.request_id, i.variant,
               bool_or('V2_FALLBACK' = ANY(COALESCE(i.reason_codes, ARRAY[]::text[]))) AS fb
        FROM imp i
        GROUP BY i.request_id, i.variant
    )
    SELECT x.metric, x.value FROM (VALUES
        ('days_with_impressions',
            (SELECT count(DISTINCT (i.shown_at AT TIME ZONE 'Asia/Kolkata')::date) FROM imp i)::numeric),
        ('impressions_total',            (SELECT count(*) FROM imp)::numeric),
        ('candidates_with_impressions',  (SELECT count(DISTINCT i.candidate_user_id) FROM imp i)::numeric),
        ('requests_v1',                  (SELECT count(*) FROM req r WHERE r.variant = 'v1')::numeric),
        ('requests_v2',                  (SELECT count(*) FROM req r WHERE r.variant = 'v2')::numeric),
        ('v2_fallback_pct',
            (SELECT round(100.0 * count(*) FILTER (WHERE r.fb) / NULLIF(count(*), 0), 2)
             FROM req r WHERE r.variant = 'v2')),
        ('viewed_events',
            (SELECT count(*) FROM public.job_recommendation_feedback f
             WHERE f.action = 'viewed' AND f.created_at >= now() - make_interval(days => _days))::numeric),
        ('saved_events',
            (SELECT count(*) FROM public.saved_jobs s
             WHERE s.created_at >= now() - make_interval(days => _days))::numeric),
        ('applications',
            (SELECT count(*) FROM public.applications a
             WHERE a.created_at >= now() - make_interval(days => _days))::numeric)
    ) AS x(metric, value);
END;
$$;

REVOKE ALL ON FUNCTION public.recommendation_data_health(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recommendation_data_health(int) TO authenticated;

-- ── E. Training examples (platform admins only; gate G3, not used yet) ──
-- One row per matured impression of the default-ranked feed, with the serve-time
-- feature snapshot (features, score, rank_score, position) and the label. This is
-- RAW exposure data: collapse duplicates and handle position/exposure bias when
-- training. Staff are NOT excluded here (the export is for training, not the readout).
CREATE OR REPLACE FUNCTION public.recommendation_training_examples(_days int DEFAULT 30, _limit int DEFAULT 100000)
RETURNS TABLE (
    candidate_user_id uuid, job_id uuid, request_id uuid, variant text, pos int,
    shown_at timestamptz, score numeric, rank_score numeric, recommendation_stage text,
    reason_codes text[], features jsonb, feature_version int, relevant_only boolean,
    label_viewed boolean, label_saved boolean, label_applied boolean, gain int
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
    IF NOT public.has_platform_role(auth.uid(), 'super_admin') THEN
        RAISE EXCEPTION 'insufficient_permissions';
    END IF;

    RETURN QUERY
    SELECT l.candidate_user_id, l.job_id, l.request_id, l.variant, l.pos,
           l.shown_at, l.score, l.rank_score, l.recommendation_stage,
           l.reason_codes, l.features, l.feature_version, l.relevant_only,
           l.label_viewed, l.label_saved, l.label_applied, l.gain
    FROM public.recommendation_labelled_impressions l
    WHERE l.sort = 'recommended'
      AND l.shown_at >= now() - make_interval(days => _days)
    ORDER BY l.shown_at
    LIMIT _limit;
END;
$$;

REVOKE ALL ON FUNCTION public.recommendation_training_examples(int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recommendation_training_examples(int, int) TO authenticated;
