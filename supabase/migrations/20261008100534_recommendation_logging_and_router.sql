-- ============================================================
-- Recommendation logging foundation + routed feed entry point
-- ============================================================
-- Why: the feed could not be measured or tuned.
--   * /jobs (Browse) logged no impressions; only the dashboard did.
--   * The dashboard's "Top jobs" tab inserted source='top', which the
--     job_impressions CHECK rejects — the error was silently swallowed.
--   * 'viewed' feedback was never written.
--   * Rows lacked request id / variant / score / position-in-request / features.
-- This migration adds attribution columns, a server-side logging router that
-- wraps V1 UNCHANGED, and a deduped server-side 'viewed' event.
-- Everything is additive and re-runnable. V1 is not touched.

-- ── 1. Attribution + feature-snapshot columns ───────────────
ALTER TABLE public.job_impressions
    ADD COLUMN IF NOT EXISTS request_id uuid,
    ADD COLUMN IF NOT EXISTS variant text NOT NULL DEFAULT 'v1',
    ADD COLUMN IF NOT EXISTS score numeric(6,4),
    ADD COLUMN IF NOT EXISTS rank_score numeric(6,4),
    ADD COLUMN IF NOT EXISTS recommendation_stage text,
    ADD COLUMN IF NOT EXISTS sort text,
    ADD COLUMN IF NOT EXISTS relevant_only boolean,
    ADD COLUMN IF NOT EXISTS reason_codes text[],
    ADD COLUMN IF NOT EXISTS features jsonb,
    ADD COLUMN IF NOT EXISTS feature_version int NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_job_impressions_shown_at
    ON public.job_impressions (shown_at);
CREATE INDEX IF NOT EXISTS idx_job_impressions_request
    ON public.job_impressions (request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_job_impressions_candidate_job
    ON public.job_impressions (candidate_user_id, job_id, shown_at DESC);
-- ── 2. Row type shared by V1 passthrough and (Plan 2) V2 ────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = 'job_feed_row'
    ) THEN
        CREATE TYPE public.job_feed_row AS (
            id uuid, company_id uuid, title text, city text, state text, locality text,
            min_salary integer, max_salary integer, salary_period text,
            job_type text, work_mode text, min_experience_years integer, max_experience_years integer,
            education text, skills text[], created_at timestamptz, pay_type text,
            avg_incentive_monthly integer, company_name text, company_is_verified boolean,
            boosted boolean, score numeric, score_breakdown jsonb, recommendation_stage text,
            total_count bigint,
            request_id uuid, variant text, rank_score numeric, reason_codes text[], features jsonb
        );
    END IF;
END $$;
-- Guard: the first 25 attributes of job_feed_row must be V1's RETURNS TABLE
-- columns, 1:1 in name, type and order, and the type must have exactly 30
-- attributes. recommendation_fetch_v1 below maps them positionally, so any
-- drift would silently misalign columns.
DO $$
DECLARE
    _v1_oid oid;
    _names text[];
    _types oid[];
    _modes "char"[];
    _i int;
    _k int := 0;
    _attr record;
BEGIN
    SELECT p.oid, p.proargnames, p.proallargtypes::oid[], p.proargmodes
      INTO _v1_oid, _names, _types, _modes
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'recommend_jobs_for_candidate' AND p.pronargs = 20;
    IF _v1_oid IS NULL THEN
        RAISE EXCEPTION 'recommend_jobs_for_candidate (20 args) not found';
    END IF;

    IF (SELECT count(*) FROM pg_attribute a
        WHERE a.attrelid = (SELECT typrelid FROM pg_type WHERE oid = 'public.job_feed_row'::regtype)
          AND a.attnum > 0 AND NOT a.attisdropped) <> 30 THEN
        RAISE EXCEPTION 'job_feed_row must have exactly 30 attributes';
    END IF;

    FOR _i IN 1 .. array_length(_names, 1) LOOP
        IF _modes[_i] = 't' THEN
            _k := _k + 1;
            SELECT a.attname, a.atttypid INTO _attr
            FROM pg_attribute a
            WHERE a.attrelid = (SELECT typrelid FROM pg_type WHERE oid = 'public.job_feed_row'::regtype)
              AND a.attnum = _k AND NOT a.attisdropped;
            IF _attr.attname IS DISTINCT FROM _names[_i] OR _attr.atttypid IS DISTINCT FROM _types[_i] THEN
                RAISE EXCEPTION 'job_feed_row attribute % (%) does not match V1 output column % (type oid %)',
                    _k, _attr.attname, _names[_i], _types[_i];
            END IF;
        END IF;
    END LOOP;
    IF _k <> 25 THEN
        RAISE EXCEPTION 'expected V1 to return 25 columns, found %', _k;
    END IF;
END $$;
-- ── 3. Internal: call V1 and project into job_feed_row ──────
CREATE OR REPLACE FUNCTION public.recommendation_fetch_v1(
    _variant text, _request_id uuid, _reason_codes text[],
    _limit int, _offset int, _q text,
    _city text, _category text, _job_type text,
    _work_mode text, _min_salary int, _max_salary int,
    _min_exp int, _max_exp int, _posted_after timestamptz,
    _education text, _shift text, _english_level text,
    _company text, _vehicle boolean, _verified_only boolean,
    _relevant_only boolean, _sort text
) RETURNS SETOF public.job_feed_row
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT f.id, f.company_id, f.title, f.city, f.state, f.locality,
           f.min_salary, f.max_salary, f.salary_period, f.job_type, f.work_mode,
           f.min_experience_years, f.max_experience_years, f.education, f.skills,
           f.created_at, f.pay_type, f.avg_incentive_monthly, f.company_name, f.company_is_verified,
           f.boosted, f.score, f.score_breakdown, f.recommendation_stage, f.total_count,
           _request_id, _variant, NULL::numeric, _reason_codes, NULL::jsonb
    FROM public.recommend_jobs_for_candidate(
        _limit, _offset, _q, _city, _category, _job_type, _work_mode,
        _min_salary, _max_salary, _min_exp, _max_exp, _posted_after,
        _education, _shift, _english_level, _company,
        _vehicle, _verified_only, _relevant_only, _sort
    ) AS f
$$;
REVOKE ALL ON FUNCTION public.recommendation_fetch_v1(
    text, uuid, text[], int, int, text, text, text, text, text, int, int, int, int,
    timestamptz, text, text, text, text, boolean, boolean, boolean, text
) FROM PUBLIC, anon, authenticated;
-- ── 4. Routed feed RPC (V1 passthrough + server-side logging) ─
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
    _sort_norm text;
    _source text;
    _rows public.job_feed_row[];
BEGIN
    IF _uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated';
    END IF;

    _sort_norm := CASE
        WHEN _sort IN ('recommended', 'newest', 'oldest', 'salary_high', 'salary_low') THEN _sort
        ELSE 'recommended' END;

    -- dashboard rows are always "recommended"; the Browse page is "search" only
    -- when the candidate typed a query.
    _source := CASE
        WHEN _surface = 'dashboard' THEN 'recommended'
        WHEN NULLIF(btrim(COALESCE(_q, '')), '') IS NOT NULL THEN 'search'
        ELSE 'browse' END;

    _rows := ARRAY(
        SELECT r FROM public.recommendation_fetch_v1(
            'v1', _request_id, NULL::text[],
            _limit, _offset, _q, _city, _category, _job_type, _work_mode,
            _min_salary, _max_salary, _min_exp, _max_exp, _posted_after,
            _education, _shift, _english_level, _company,
            _vehicle, _verified_only, _relevant_only, _sort_norm
        ) AS r
    );

    IF COALESCE(cardinality(_rows), 0) = 0 THEN
        RETURN;
    END IF;

    -- Best-effort logging: only real candidates; never fails the feed.
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
                -- burst guard (double fetch / retry): same job, same sort, last 10 s
                SELECT 1 FROM public.job_impressions x
                WHERE x.candidate_user_id = _uid AND x.job_id = u.id
                  AND x.sort = _sort_norm AND x.shown_at > now() - interval '10 seconds'
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
-- ── 5. Durable 'viewed' event (server-side, deduped per IST day) ─
CREATE OR REPLACE FUNCTION public.log_job_view(_job_id uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    _uid uuid := auth.uid();
    _day_start timestamptz :=
        date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata';
BEGIN
    IF _uid IS NULL THEN RETURN; END IF;
    -- employers / admins browsing a job are not candidate signal
    IF NOT EXISTS (SELECT 1 FROM public.candidate_profiles cp WHERE cp.user_id = _uid) THEN RETURN; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = _job_id) THEN RETURN; END IF;

    INSERT INTO public.job_recommendation_feedback (candidate_user_id, job_id, action)
    SELECT _uid, _job_id, 'viewed'
    WHERE NOT EXISTS (
        SELECT 1 FROM public.job_recommendation_feedback f
        WHERE f.candidate_user_id = _uid AND f.job_id = _job_id
          AND f.action = 'viewed' AND f.created_at >= _day_start
    );
END;
$$;
REVOKE ALL ON FUNCTION public.log_job_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_job_view(uuid) TO authenticated;
-- ── 6. Retention: impressions older than 120 days are pruned nightly ─
-- cron.schedule() upserts by job name, so re-running does not duplicate.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.schedule(
            'prune-job-impressions',
            '30 21 * * *',  -- 03:00 IST
            $cron$DELETE FROM public.job_impressions WHERE shown_at < now() - interval '120 days'$cron$
        );
    END IF;
END $$;
