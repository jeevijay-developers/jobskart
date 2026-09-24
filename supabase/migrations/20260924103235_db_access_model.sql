-- DB Access Model (see db-access-model-implementation.md):
--   Phase 1 per-job unlock allowance, Phase 2 required job-scoped search,
--   Phase 3 rate limiting + audit, Phase 4 60-day response retention.
--
-- Deviations/notes vs the plan doc:
--   - Job-scoped relevancy ranking (search_candidates_for_company's _job_id/
--     match_score, get_ranked_job_applicants, compute_candidate_match) was
--     already shipped by 20260924051445_intelligent_candidate_ranking.sql.
--     This migration makes _job_id REQUIRED (was optional) so "select an
--     active job before search" is enforced server-side, not just client UX.
--   - unlock_candidate()'s existing hardcoded '-1 credit' wallet fallback is
--     replaced with plan_settings.credits_per_unlock (already existed,
--     already admin-editable via /admin/plans, was just never read).
--   - Decision (a) from the plan doc (lead model: applicant contacts viewable
--     without unlock, DB-search contacts unlock-gated) is kept as-is; this
--     migration only touches the DB-search unlock path.
--   - Decision (b): responses_locked_after (export deadline) stays at
--     expiry+7d; responses_purge_at (hard delete) is the new +60d gate. Both
--     dates are surfaced in the expiry/purge notices.

-- =====================================================================
-- Phase 1: per-job unlock allowance
-- =====================================================================

ALTER TABLE public.plan_settings
  ADD COLUMN IF NOT EXISTS unlocks_per_job integer NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS db_searches_per_hour integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS db_rows_per_day integer NOT NULL DEFAULT 1000;

CREATE TABLE IF NOT EXISTS public.job_unlock_allowance (
  job_id uuid PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  total int NOT NULL,
  used int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_unlock_allowance_bounds CHECK (used >= 0 AND used <= total)
);
CREATE INDEX IF NOT EXISTS idx_job_unlock_allowance_company ON public.job_unlock_allowance(company_id);
GRANT SELECT ON public.job_unlock_allowance TO authenticated;
GRANT ALL ON public.job_unlock_allowance TO service_role;
ALTER TABLE public.job_unlock_allowance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members read allowance" ON public.job_unlock_allowance;
CREATE POLICY "members read allowance" ON public.job_unlock_allowance
  FOR SELECT TO authenticated
  USING (public.has_company_membership(auth.uid(), company_id));

DROP TRIGGER IF EXISTS tg_job_unlock_allowance_updated_at ON public.job_unlock_allowance;
CREATE TRIGGER tg_job_unlock_allowance_updated_at
  BEFORE UPDATE ON public.job_unlock_allowance
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.candidate_unlocks ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_candidate_unlocks_job ON public.candidate_unlocks(job_id);

-- Seed an allowance row the first time a job becomes (or is created) active.
-- ON CONFLICT DO NOTHING keeps this idempotent across renewals/re-activations
-- so an employer never gets a second free batch of unlocks by pausing+resuming.
CREATE OR REPLACE FUNCTION public.tg_seed_job_unlock_allowance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _total int;
BEGIN
  IF NEW.status = 'active' THEN
    SELECT unlocks_per_job INTO _total FROM public.plan_settings WHERE id = 1;
    INSERT INTO public.job_unlock_allowance (job_id, company_id, total)
      VALUES (NEW.id, NEW.company_id, COALESCE(_total, 25))
      ON CONFLICT (job_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_seed_unlock_allowance_ins ON public.jobs;
CREATE TRIGGER tg_seed_unlock_allowance_ins AFTER INSERT ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_seed_job_unlock_allowance();

DROP TRIGGER IF EXISTS tg_seed_unlock_allowance_upd ON public.jobs;
CREATE TRIGGER tg_seed_unlock_allowance_upd AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW WHEN (NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active')
  EXECUTE FUNCTION public.tg_seed_job_unlock_allowance();

-- Backfill: every currently-active job gets an allowance row. Historical
-- unlocks predate job-scoping and are not retro-attributed (used = 0 per
-- decision (e) in the plan doc) — they were already paid for once via the
-- flat-credit model and re-charging them against a new allowance would be
-- double billing.
INSERT INTO public.job_unlock_allowance (job_id, company_id, total)
SELECT j.id, j.company_id, COALESCE((SELECT unlocks_per_job FROM public.plan_settings WHERE id = 1), 25)
FROM public.jobs j
WHERE j.status = 'active'
ON CONFLICT (job_id) DO NOTHING;

-- unlock_candidate() v3: job-scoped, allowance-first, wallet-fallback in one
-- atomic RPC. The job row lock (FOR UPDATE) plus the allowance UPDATE's
-- WHERE used < total make double-consuming the last slot from two tabs
-- impossible (standing rule 2). Signature changes ( _job_id inserted,
-- already_unlocked/balance_after keeps its old order so existing callers
-- reading the first two columns positionally still work, source/
-- allowance_left are new) — old signature is dropped since PostgREST/pg
-- can't have two functions differing only in a return-type change without
-- ambiguity for callers using named params.
DROP FUNCTION IF EXISTS public.unlock_candidate(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.unlock_candidate(
  _company_id uuid,
  _job_id uuid,
  _candidate_user_id uuid,
  _actor uuid DEFAULT NULL
) RETURNS TABLE (already_unlocked boolean, balance_after int, source text, allowance_left int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _exists boolean;
  _bal int;
  _job_company uuid;
  _job_status public.job_status;
  _job_expires timestamptz;
  _per_unlock int;
  _consumed int;
  _left int;
BEGIN
  SELECT company_id, status, expires_at INTO _job_company, _job_status, _job_expires
    FROM public.jobs WHERE id = _job_id FOR UPDATE;

  IF _job_company IS NULL OR _job_company <> _company_id THEN
    RAISE EXCEPTION 'job_not_active';
  END IF;
  IF _job_status <> 'active' OR (_job_expires IS NOT NULL AND _job_expires <= now()) THEN
    RAISE EXCEPTION 'job_not_active';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.candidate_unlocks
                WHERE company_id = _company_id AND candidate_user_id = _candidate_user_id)
    INTO _exists;
  IF _exists THEN
    SELECT balance INTO _bal FROM public.employer_credit_wallets WHERE company_id = _company_id;
    SELECT total - used INTO _left FROM public.job_unlock_allowance WHERE job_id = _job_id;
    RETURN QUERY SELECT true, COALESCE(_bal, 0), 'already'::text, _left;
    RETURN;
  END IF;

  -- Allowance-first: atomic row-locked consume via the WHERE guard.
  UPDATE public.job_unlock_allowance
    SET used = used + 1
    WHERE job_id = _job_id AND used < total
    RETURNING total - used INTO _left;
  GET DIAGNOSTICS _consumed = ROW_COUNT;

  IF _consumed = 1 THEN
    SELECT balance INTO _bal FROM public.employer_credit_wallets WHERE company_id = _company_id;
    INSERT INTO public.candidate_unlocks (company_id, job_id, candidate_user_id, unlocked_by, credits_spent)
      VALUES (_company_id, _job_id, _candidate_user_id, _actor, 0);
    RETURN QUERY SELECT false, COALESCE(_bal, 0), 'allowance'::text, _left;
    RETURN;
  END IF;

  -- Wallet fallback once the job's allowance is exhausted.
  SELECT COALESCE(credits_per_unlock, 5) INTO _per_unlock FROM public.plan_settings WHERE id = 1;
  BEGIN
    _bal := public.apply_credit_delta(
      _company_id, -_per_unlock, 'unlock'::public.credit_txn_kind,
      jsonb_build_object('candidate_user_id', _candidate_user_id, 'job_id', _job_id), _actor
    );
  EXCEPTION WHEN raise_exception THEN
    RAISE EXCEPTION 'no_credits';
  END;

  INSERT INTO public.candidate_unlocks (company_id, job_id, candidate_user_id, unlocked_by, credits_spent)
    VALUES (_company_id, _job_id, _candidate_user_id, _actor, _per_unlock);
  RETURN QUERY SELECT false, _bal, 'credits'::text, 0;
END $$;

REVOKE ALL ON FUNCTION public.unlock_candidate(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unlock_candidate(uuid, uuid, uuid, uuid) TO service_role;

-- =====================================================================
-- Phase 2: job selection is now required for a DB search, not optional
-- =====================================================================

DROP FUNCTION IF EXISTS public.search_candidates_for_company(uuid, text, text[], int, int, int, uuid, text);

CREATE OR REPLACE FUNCTION public.search_candidates_for_company(
  _company_id uuid,
  _job_id uuid,
  _query text DEFAULT NULL,
  _cities text[] DEFAULT NULL,
  _min_experience int DEFAULT NULL,
  _limit int DEFAULT 40,
  _offset int DEFAULT 0,
  _sort_by text DEFAULT 'relevance'
) RETURNS TABLE (
  user_id uuid,
  profile_slug text,
  headline text,
  last_role text,
  years_experience int,
  skills text[],
  preferred_cities text[],
  preferred_work_mode text,
  full_name text,
  avatar_url text,
  city text,
  total_count bigint,
  match_score int,
  match_breakdown jsonb,
  tags text[]
)
LANGUAGE plpgsql
-- Not STABLE: this function writes an audit/rate-limit row to
-- employer_activity on every call (log_employer_activity below) and reads
-- that same table's rolling counters, both of which are side effects /
-- non-repeatable reads a STABLE label would misrepresent to the planner.
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _term text := NULLIF(btrim(_query), '');
  _clamped_limit int := LEAST(GREATEST(COALESCE(_limit, 40), 1), 50);
  _hourly_cap int;
  _daily_row_cap int;
  _recent_searches int;
  _rows_today int;
  _returned_rows int;
BEGIN
  IF NOT public.has_company_membership(auth.uid(), _company_id) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  IF _job_id IS NULL THEN
    RAISE EXCEPTION 'job_not_active';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.jobs j
    WHERE j.id = _job_id AND j.company_id = _company_id AND j.status = 'active'
      AND (j.expires_at IS NULL OR j.expires_at > now())
  ) THEN
    RAISE EXCEPTION 'job_not_active';
  END IF;

  SELECT db_searches_per_hour, db_rows_per_day INTO _hourly_cap, _daily_row_cap
    FROM public.plan_settings WHERE id = 1;

  SELECT count(*) INTO _recent_searches
    FROM public.employer_activity
    WHERE company_id = _company_id AND kind = 'db_search_run' AND created_at > now() - interval '1 hour';
  IF _recent_searches >= COALESCE(_hourly_cap, 60) THEN
    RAISE EXCEPTION 'rate_limited';
  END IF;

  SELECT COALESCE(sum((metadata->>'result_count')::int), 0) INTO _rows_today
    FROM public.employer_activity
    WHERE company_id = _company_id AND kind = 'db_search_run'
      AND created_at > date_trunc('day', now());
  IF _rows_today >= COALESCE(_daily_row_cap, 1000) THEN
    RAISE EXCEPTION 'rate_limited';
  END IF;

  RETURN QUERY
  WITH matched AS (
    SELECT
      cp.user_id, cp.profile_slug, cp.headline, cp.last_role, cp.years_experience,
      cp.skills, cp.preferred_cities, cp.preferred_work_mode,
      p.full_name, p.avatar_url, p.city,
      count(*) OVER() AS total_count,
      (m.result->>'score')::int AS match_score,
      m.result->'breakdown' AS match_breakdown,
      ARRAY(SELECT jsonb_array_elements_text(m.result->'tags')) AS tags
    FROM public.candidate_profiles cp
    JOIN public.profiles p ON p.id = cp.user_id
    CROSS JOIN LATERAL (SELECT public.compute_candidate_match(cp.user_id, _job_id, true) AS result) m
    WHERE cp.onboarding_completed = true
      AND (_min_experience IS NULL OR cp.years_experience >= _min_experience)
      AND (
        _cities IS NULL OR cardinality(_cities) = 0
        OR cp.preferred_cities && _cities
        OR p.city = ANY(_cities)
      )
      AND (
        _term IS NULL
        OR cp.headline ILIKE ('%' || _term || '%')
        OR cp.last_role ILIKE ('%' || _term || '%')
        OR EXISTS (SELECT 1 FROM unnest(cp.skills) s WHERE s ILIKE ('%' || _term || '%'))
      )
    ORDER BY
      CASE WHEN _sort_by = 'match' OR _sort_by = 'relevance' THEN (m.result->>'score')::int END DESC NULLS LAST,
      CASE WHEN _sort_by = 'experience' THEN cp.years_experience END DESC NULLS LAST,
      cp.profile_strength DESC, cp.years_experience DESC
    LIMIT _clamped_limit OFFSET _offset
  )
  SELECT * FROM matched;
  GET DIAGNOSTICS _returned_rows = ROW_COUNT;

  PERFORM public.log_employer_activity(_company_id, auth.uid(), 'db_search_run', 'Ran a candidate database search',
    NULL, NULL, jsonb_build_object('job_id', _job_id, 'query', _term, 'result_count', _returned_rows));
END;
$$;

REVOKE ALL ON FUNCTION public.search_candidates_for_company(uuid, uuid, text, text[], int, int, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_candidates_for_company(uuid, uuid, text, text[], int, int, int, text) TO authenticated;

-- =====================================================================
-- Phase 3: scraping / leakage hardening — contact-view audit + export cap
-- =====================================================================

-- register_download() gains a hard per-call cap (defense in depth alongside
-- the client's existing .limit(1000)) and now also writes to
-- employer_activity so exports show up in the same audit trail as searches
-- and unlocks, not just the per-user download_events/download_ledger rows.
CREATE OR REPLACE FUNCTION public.register_download(_company_id uuid, _kind text, _count integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _today date := (now() at time zone 'utc')::date; _new integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _count <= 0 THEN RAISE EXCEPTION 'Invalid count'; END IF;
  IF _count > 1000 THEN RAISE EXCEPTION 'export_too_large'; END IF;
  INSERT INTO public.download_ledger(user_id, kind, day, count) VALUES (_uid, _kind, _today, _count)
    ON CONFLICT (user_id, kind, day) DO UPDATE SET count = public.download_ledger.count + EXCLUDED.count
    RETURNING count INTO _new;
  IF _new > 300 THEN RAISE EXCEPTION 'Daily download limit (300) reached'; END IF;
  INSERT INTO public.download_events(user_id, company_id, kind, row_count)
    VALUES (_uid, _company_id, _kind, _count);
  IF _company_id IS NOT NULL THEN
    PERFORM public.log_employer_activity(_company_id, _uid, 'export_run', 'Exported ' || _kind,
      _count || ' row(s)', NULL, jsonb_build_object('kind', _kind, 'row_count', _count));
  END IF;
  RETURN _new;
END $$;

-- Standalone contact-view audit helper so any future contact-reveal surface
-- (not just unlockCandidateContact) writes the same 'contact_viewed' kind
-- the plan calls for, without duplicating the log_employer_activity call
-- at each call site.
CREATE OR REPLACE FUNCTION public.log_contact_viewed(_company_id uuid, _candidate_user_id uuid, _job_id uuid, _actor uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.log_employer_activity(_company_id, _actor, 'contact_viewed', 'Viewed candidate contact',
    NULL, '/employer/database', jsonb_build_object('candidate_user_id', _candidate_user_id, 'job_id', _job_id));
$$;
REVOKE ALL ON FUNCTION public.log_contact_viewed(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_contact_viewed(uuid, uuid, uuid, uuid) TO service_role;

-- =====================================================================
-- Phase 4: 60-day response retention (CLAUDE.md P0 item)
-- =====================================================================

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS responses_purge_at timestamptz;

CREATE OR REPLACE FUNCTION public.tg_jobs_lock_window()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.expires_at IS NOT NULL THEN
    NEW.responses_locked_after := NEW.expires_at + interval '7 days';
    NEW.responses_purge_at := NEW.expires_at + interval '60 days';
  END IF;
  RETURN NEW;
END $$;

UPDATE public.jobs SET responses_purge_at = expires_at + interval '60 days'
  WHERE expires_at IS NOT NULL AND responses_purge_at IS NULL;

CREATE TABLE IF NOT EXISTS public.job_response_purges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  purged_at timestamptz NOT NULL DEFAULT now(),
  purged_count integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_job_response_purges_job ON public.job_response_purges(job_id);
GRANT SELECT ON public.job_response_purges TO authenticated;
GRANT ALL ON public.job_response_purges TO service_role;
ALTER TABLE public.job_response_purges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read purge ledger" ON public.job_response_purges
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_response_purges.job_id
                 AND public.has_company_membership(auth.uid(), j.company_id)));

-- purge_expired_responses(): the single place application rows get deleted
-- for retention. jobs.applications_count is an incremented counter (never
-- decremented by application deletes), so it already survives the purge as
-- the historical total without any extra snapshot step — this function only
-- adds a job_response_purges ledger row recording how many rows were removed
-- and when. Idempotent: the WHERE + FOR UPDATE means a retried/duplicate
-- sweep run finds nothing left to claim.
CREATE OR REPLACE FUNCTION public.purge_expired_responses()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _r RECORD;
  _deleted int;
  _result jsonb := '[]'::jsonb;
BEGIN
  FOR _r IN
    SELECT j.id, j.company_id, j.title
    FROM public.jobs j
    WHERE j.responses_purge_at IS NOT NULL AND j.responses_purge_at <= now()
      AND EXISTS (SELECT 1 FROM public.applications a WHERE a.job_id = j.id)
    FOR UPDATE OF j
  LOOP
    DELETE FROM public.applications WHERE job_id = _r.id;
    GET DIAGNOSTICS _deleted = ROW_COUNT;
    IF _deleted > 0 THEN
      INSERT INTO public.job_response_purges (job_id, purged_count) VALUES (_r.id, _deleted);
      PERFORM public.log_employer_activity(_r.company_id, NULL, 'responses.purged', 'Responses purged (60-day retention)',
        _deleted || ' response(s) removed for "' || _r.title || '"', '/employer/responses',
        jsonb_build_object('job_id', _r.id, 'purged_count', _deleted));
      _result := _result || jsonb_build_object('job_id', _r.id, 'company_id', _r.company_id, 'title', _r.title, 'purged_count', _deleted);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('purged', _result);
END $$;
REVOKE ALL ON FUNCTION public.purge_expired_responses() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_responses() TO service_role;

-- T-7-before-purge reminder claim, same atomic-claim pattern as
-- claim_due_expiry_reminders() in 20260924120000_job_expiry_renewal.sql.
CREATE TABLE IF NOT EXISTS public.job_purge_reminders (
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id)
);
GRANT ALL ON public.job_purge_reminders TO service_role;
ALTER TABLE public.job_purge_reminders ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.claim_due_purge_reminders()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _claimed jsonb;
BEGIN
  WITH due AS (
    SELECT j.id, j.company_id, j.title, j.responses_purge_at
    FROM public.jobs j
    WHERE j.responses_purge_at IS NOT NULL
      AND j.responses_purge_at > now()
      AND j.responses_purge_at <= now() + interval '7 days'
      AND EXISTS (SELECT 1 FROM public.applications a WHERE a.job_id = j.id)
      AND NOT EXISTS (SELECT 1 FROM public.job_purge_reminders r WHERE r.job_id = j.id)
    FOR UPDATE OF j
  ), ins AS (
    INSERT INTO public.job_purge_reminders (job_id)
    SELECT id FROM due
    ON CONFLICT (job_id) DO NOTHING
    RETURNING job_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'job_id', d.id, 'company_id', d.company_id, 'title', d.title, 'purge_at', d.responses_purge_at)), '[]'::jsonb)
  INTO _claimed
  FROM due d JOIN ins i ON i.job_id = d.id;
  RETURN _claimed;
END $$;
REVOKE ALL ON FUNCTION public.claim_due_purge_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_purge_reminders() TO service_role;

-- NOTE: process_job_expiry_batch() is intentionally NOT touched here.
-- 20260924120000_job_expiry_renewal.sql (which defines it, plus
-- company_auto_renew() and jobs.auto_renew) was written locally but has not
-- actually been applied to this project's live database yet (verified via
-- to_regprocedure before writing this migration) — recreating a function
-- that calls company_auto_renew() would fail to compile until that
-- migration ships. When it does ship, a follow-up migration should add
-- expires_at to process_job_expiry_batch()'s pass-2 RETURNING so
-- job-expiry-sweep's notice can state the purge date (the edge function
-- already handles expires_at being present or absent gracefully).

-- Daily sweep, same net.http_post wiring as job-expiry-sweep.
SELECT cron.schedule(
  'response-retention-sweep',
  '30 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://swdntxurukbkyksuyzhg.functions.supabase.co/response-retention-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
