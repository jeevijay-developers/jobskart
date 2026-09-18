-- Slice 1 of the in-app video interview feature: schema + SECURITY DEFINER
-- RPCs for platform-hosted (Zoom) interview scheduling, layered on top of the
-- existing public.interviews table (see 20260714063327_...sql).
--
-- Design notes:
--  * v1 targets a SINGLE Zoom host account (ZOOM_HOST_USER_ID, resolved by the
--    server layer from env, passed into these RPCs as _host_user_id). No
--    separate "zoom_hosts" table is introduced yet — conflict-checking reads
--    directly off public.interviews, so adding more hosts later is just a
--    matter of passing a different _host_user_id; a dedicated host-pool table
--    can be layered on when there is a second Zoom account to schedule
--    against.
--  * Risk gating derives from the verification columns that already exist on
--    public.companies (verification_status, spam_suspected) rather than a new
--    tiered risk column: spam_suspected blocks scheduling outright,
--    verification_status <> 'verified' blocks the platform-Zoom path only
--    (external_link scheduling, i.e. today's BYO-link behavior, stays open).
--  * Raw Zoom meeting credentials (password, start_url) never touch a table
--    authenticated/anon can read — public.interview_zoom_secrets has RLS
--    enabled with zero policies, so only service_role (i.e. supabaseAdmin in
--    the TanStack server layer) can read/write it.

-- 1) Provider enum -----------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.interview_provider AS ENUM ('jobskart_zoom', 'external_link');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) New columns on public.interviews ----------------------------------------
ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  ADD COLUMN IF NOT EXISTS provider public.interview_provider NOT NULL DEFAULT 'external_link',
  ADD COLUMN IF NOT EXISTS host_user_id text,
  ADD COLUMN IF NOT EXISTS scheduled_email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text;

CREATE INDEX IF NOT EXISTS idx_interviews_host_schedule
  ON public.interviews (host_user_id, scheduled_at)
  WHERE provider = 'jobskart_zoom';

CREATE INDEX IF NOT EXISTS idx_interviews_reminder_pending
  ON public.interviews (scheduled_at)
  WHERE status IN ('scheduled', 'rescheduled') AND reminder_email_sent_at IS NULL;

-- 3) Close the direct-write gap for platform-Zoom rows ------------------------
-- The original RLS policy lets any company member INSERT/UPDATE any column,
-- including `provider`. That's still fine (and required) for the legacy
-- external_link/manual path, but a jobskart_zoom row must only ever be
-- created by reserve_video_interview_slot() below, which does the risk-gate
-- check, the T+1-day-IST check, and the host-conflict advisory lock that a
-- plain RLS-checked client INSERT cannot safely do. SECURITY DEFINER
-- functions in this project run as the (BYPASSRLS) table owner, so the RPCs
-- below are unaffected by this tightened WITH CHECK.
DROP POLICY IF EXISTS "company members write interviews" ON public.interviews;
CREATE POLICY "company members write interviews" ON public.interviews
  FOR ALL TO authenticated
  USING (public.has_company_membership(auth.uid(), company_id))
  WITH CHECK (public.has_company_membership(auth.uid(), company_id) AND provider = 'external_link');

-- 4) Secrets table (service_role only) ----------------------------------------
CREATE TABLE IF NOT EXISTS public.interview_zoom_secrets (
  interview_id uuid PRIMARY KEY REFERENCES public.interviews(id) ON DELETE CASCADE,
  zoom_meeting_id text NOT NULL,
  zoom_meeting_uuid text,
  zoom_password text NOT NULL,
  zoom_host_user_id text NOT NULL,
  zoom_start_url text,
  zoom_join_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.interview_zoom_secrets TO service_role;
ALTER TABLE public.interview_zoom_secrets ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies for authenticated/anon: candidate phone/email
-- rules (CLAUDE.md) apply equally to raw Zoom join credentials, and this is
-- the SQL-level exclusion CLAUDE.md requires instead of hiding fields in React.

CREATE TRIGGER trg_interview_zoom_secrets_updated
  BEFORE UPDATE ON public.interview_zoom_secrets
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 5) reserve_video_interview_slot() -------------------------------------------
CREATE OR REPLACE FUNCTION public.reserve_video_interview_slot(
  _application_id uuid,
  _scheduled_at timestamptz,
  _duration_min int,
  _provider public.interview_provider,
  _mode public.interview_mode,
  _location text DEFAULT NULL,
  _meeting_url text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _host_user_id text DEFAULT NULL,
  _actor uuid DEFAULT NULL
) RETURNS public.interviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _app record;
  _verification_status text;
  _spam_suspected boolean;
  _min_start timestamptz;
  _interview public.interviews;
BEGIN
  SELECT id, company_id, candidate_id, job_id, status
    INTO _app
    FROM public.applications
    WHERE id = _application_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'application_not_found';
  END IF;

  IF _actor IS NULL OR NOT public.has_company_membership(_actor, _app.company_id) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  IF _app.status IN ('rejected', 'withdrawn') THEN
    RAISE EXCEPTION 'application_not_eligible_for_interview';
  END IF;

  IF _duration_min IS NULL OR _duration_min <= 0 THEN
    RAISE EXCEPTION 'invalid_duration';
  END IF;

  SELECT verification_status, spam_suspected
    INTO _verification_status, _spam_suspected
    FROM public.companies
    WHERE id = _app.company_id;

  IF COALESCE(_spam_suspected, false) THEN
    RAISE EXCEPTION 'employer_flagged_spam';
  END IF;

  IF _provider = 'jobskart_zoom' THEN
    IF COALESCE(_verification_status, 'unverified') <> 'verified' THEN
      RAISE EXCEPTION 'verification_required_for_video_interview';
    END IF;
    IF _host_user_id IS NULL OR length(trim(_host_user_id)) = 0 THEN
      RAISE EXCEPTION 'zoom_not_configured';
    END IF;
  END IF;

  _min_start := (date_trunc('day', (now() AT TIME ZONE 'Asia/Kolkata')) + interval '1 day') AT TIME ZONE 'Asia/Kolkata';
  IF _scheduled_at < _min_start THEN
    RAISE EXCEPTION 'interview_must_be_tomorrow_or_later';
  END IF;

  IF _provider = 'jobskart_zoom' THEN
    -- Serializes concurrent reservation attempts against the same host; a
    -- plain SELECT has nothing to lock against when no conflicting row
    -- exists yet, which is exactly the race two browser tabs can hit.
    PERFORM pg_advisory_xact_lock(hashtext('zoom_host:' || _host_user_id));

    PERFORM 1 FROM public.interviews
      WHERE provider = 'jobskart_zoom'
        AND host_user_id = _host_user_id
        AND status NOT IN ('cancelled')
        AND scheduled_at < (_scheduled_at + make_interval(mins => _duration_min))
        AND (scheduled_at + make_interval(mins => duration_min)) > _scheduled_at;
    IF FOUND THEN
      RAISE EXCEPTION 'host_slot_conflict';
    END IF;
  END IF;

  UPDATE public.applications
    SET status = 'interview', updated_at = now()
    WHERE id = _application_id AND status <> 'interview';

  INSERT INTO public.interviews (
    application_id, company_id, candidate_id, job_id, mode, scheduled_at, duration_min,
    location, meeting_url, notes, status, provider, host_user_id, created_by
  ) VALUES (
    _application_id, _app.company_id, _app.candidate_id, _app.job_id, _mode, _scheduled_at, _duration_min,
    _location, _meeting_url, _notes, 'scheduled', _provider, _host_user_id, _actor
  )
  RETURNING * INTO _interview;

  RETURN _interview;
END;
$$;

-- 6) attach_zoom_meeting_secrets() --------------------------------------------
-- Called after the Zoom S2S API call succeeds server-side; idempotent so a
-- retried server-function call after a network blip doesn't error.
CREATE OR REPLACE FUNCTION public.attach_zoom_meeting_secrets(
  _interview_id uuid,
  _zoom_meeting_id text,
  _zoom_meeting_uuid text,
  _zoom_password text,
  _zoom_host_user_id text,
  _zoom_start_url text DEFAULT NULL,
  _zoom_join_url text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.interviews WHERE id = _interview_id AND provider = 'jobskart_zoom'
  ) THEN
    RAISE EXCEPTION 'interview_not_found_or_not_zoom';
  END IF;

  INSERT INTO public.interview_zoom_secrets (
    interview_id, zoom_meeting_id, zoom_meeting_uuid, zoom_password, zoom_host_user_id, zoom_start_url, zoom_join_url
  ) VALUES (
    _interview_id, _zoom_meeting_id, _zoom_meeting_uuid, _zoom_password, _zoom_host_user_id, _zoom_start_url, _zoom_join_url
  )
  ON CONFLICT (interview_id) DO UPDATE SET
    zoom_meeting_id = EXCLUDED.zoom_meeting_id,
    zoom_meeting_uuid = EXCLUDED.zoom_meeting_uuid,
    zoom_password = EXCLUDED.zoom_password,
    zoom_host_user_id = EXCLUDED.zoom_host_user_id,
    zoom_start_url = EXCLUDED.zoom_start_url,
    zoom_join_url = EXCLUDED.zoom_join_url,
    updated_at = now();
END;
$$;

-- 7) reschedule_video_interview() ---------------------------------------------
-- Updates the interview row in place (same id, same Zoom meeting) rather than
-- chaining a new row — public.interview_status already has a 'rescheduled'
-- value the UI understands, so there's no need for a reschedule_of audit
-- column in v1. Resets both email-sent markers so the T-30 cron re-sends.
CREATE OR REPLACE FUNCTION public.reschedule_video_interview(
  _interview_id uuid,
  _new_scheduled_at timestamptz,
  _new_duration_min int DEFAULT NULL,
  _notes text DEFAULT NULL,
  _actor uuid DEFAULT NULL
) RETURNS public.interviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _iv public.interviews;
  _min_start timestamptz;
  _duration int;
BEGIN
  SELECT * INTO _iv FROM public.interviews WHERE id = _interview_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'interview_not_found';
  END IF;

  IF _actor IS NULL OR NOT public.has_company_membership(_actor, _iv.company_id) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  IF _iv.status IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'interview_not_reschedulable';
  END IF;

  _min_start := (date_trunc('day', (now() AT TIME ZONE 'Asia/Kolkata')) + interval '1 day') AT TIME ZONE 'Asia/Kolkata';
  IF _new_scheduled_at < _min_start THEN
    RAISE EXCEPTION 'interview_must_be_tomorrow_or_later';
  END IF;

  _duration := COALESCE(_new_duration_min, _iv.duration_min);
  IF _duration <= 0 THEN
    RAISE EXCEPTION 'invalid_duration';
  END IF;

  IF _iv.provider = 'jobskart_zoom' THEN
    PERFORM pg_advisory_xact_lock(hashtext('zoom_host:' || _iv.host_user_id));

    PERFORM 1 FROM public.interviews
      WHERE provider = 'jobskart_zoom'
        AND host_user_id = _iv.host_user_id
        AND status NOT IN ('cancelled')
        AND id <> _iv.id
        AND scheduled_at < (_new_scheduled_at + make_interval(mins => _duration))
        AND (scheduled_at + make_interval(mins => duration_min)) > _new_scheduled_at;
    IF FOUND THEN
      RAISE EXCEPTION 'host_slot_conflict';
    END IF;
  END IF;

  UPDATE public.interviews SET
    scheduled_at = _new_scheduled_at,
    duration_min = _duration,
    notes = COALESCE(_notes, notes),
    status = 'rescheduled',
    reminder_email_sent_at = NULL,
    scheduled_email_sent_at = NULL,
    updated_at = now()
  WHERE id = _interview_id
  RETURNING * INTO _iv;

  RETURN _iv;
END;
$$;

-- 8) cancel_video_interview() --------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_video_interview(
  _interview_id uuid,
  _reason text DEFAULT NULL,
  _actor uuid DEFAULT NULL
) RETURNS public.interviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _iv public.interviews;
BEGIN
  SELECT * INTO _iv FROM public.interviews WHERE id = _interview_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'interview_not_found';
  END IF;

  IF _actor IS NULL OR NOT public.has_company_membership(_actor, _iv.company_id) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  IF _iv.status IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'interview_already_closed';
  END IF;

  UPDATE public.interviews SET
    status = 'cancelled',
    cancelled_at = now(),
    cancel_reason = _reason,
    updated_at = now()
  WHERE id = _interview_id
  RETURNING * INTO _iv;

  RETURN _iv;
END;
$$;

-- 9) Lock these down to service_role only --------------------------------------
-- Same convention as apply_credit_delta/unlock_candidate (20260805034834_...sql):
-- Supabase's public schema does not grant EXECUTE to PUBLIC by default, so
-- revoking from anon/authenticated is sufficient to make these callable only
-- via supabaseAdmin (service_role) in the TanStack server layer, after that
-- layer has independently verified the caller's membership via the user-JWT
-- client — matching every other privileged RPC in this codebase.
REVOKE EXECUTE ON FUNCTION public.reserve_video_interview_slot(
  uuid, timestamptz, int, public.interview_provider, public.interview_mode, text, text, text, text, uuid
) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attach_zoom_meeting_secrets(
  uuid, text, text, text, text, text, text
) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reschedule_video_interview(
  uuid, timestamptz, int, text, uuid
) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_video_interview(
  uuid, text, uuid
) FROM anon, authenticated;
