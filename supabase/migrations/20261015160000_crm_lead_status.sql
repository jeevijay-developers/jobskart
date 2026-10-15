-- CRM "Update Status" needs to behave differently for unlock-only leads
-- (no applications row to carry a status) vs application-backed leads
-- (existing applications.status / update_application_status workflow,
-- unchanged). This adds a lightweight lead-engagement status on
-- candidate_unlocks — the record an unlock-only lead actually has — and a
-- company-scoped RPC to change it, mirroring the existing
-- update_application_status()/log_employer_activity() conventions.

ALTER TABLE public.candidate_unlocks
  ADD COLUMN IF NOT EXISTS lead_status text NOT NULL DEFAULT 'new';

DO $$ BEGIN
  ALTER TABLE public.candidate_unlocks
    ADD CONSTRAINT candidate_unlocks_lead_status_check
    CHECK (lead_status IN ('new', 'contacted', 'interested', 'follow_up_required', 'not_interested', 'unreachable'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- get_crm_leads: unlock-only rows (no application) now surface their real
-- lead_status instead of a hardcoded 'new' — application-backed rows are
-- unaffected (app.status still takes priority via COALESCE).
CREATE OR REPLACE FUNCTION public.get_crm_leads(
  _company_id uuid,
  _job_id uuid DEFAULT NULL,
  _source text DEFAULT NULL,
  _stage text DEFAULT NULL,
  _contacted boolean DEFAULT NULL,
  _limit integer DEFAULT 50,
  _offset integer DEFAULT 0
)
RETURNS TABLE (
  candidate_id uuid,
  application_id uuid,
  source text,
  stage text,
  job_id uuid,
  job_title text,
  full_name text,
  city text,
  avatar_url text,
  headline text,
  applied_at timestamptz,
  unlocked_at timestamptz,
  contacted boolean,
  last_call_at timestamptz,
  last_outcome text,
  open_tasks integer,
  next_follow_up_at timestamptz,
  total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_company_membership(auth.uid(), _company_id) THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;

  RETURN QUERY
  WITH app AS (
    SELECT DISTINCT ON (a.candidate_id)
           a.id AS application_id, a.candidate_id, a.job_id,
           a.status::text AS status, a.created_at
      FROM public.applications a
     WHERE a.company_id = _company_id
     ORDER BY a.candidate_id, a.created_at DESC
  ), unk AS (
    SELECT DISTINCT ON (u.candidate_user_id)
           u.candidate_user_id, u.created_at AS unlocked_at, u.job_id, u.lead_status
      FROM public.candidate_unlocks u
     WHERE u.company_id = _company_id
     ORDER BY u.candidate_user_id, u.created_at DESC
  ), leads AS (
    SELECT
      COALESCE(app.candidate_id, unk.candidate_user_id) AS candidate_id,
      app.application_id,
      CASE WHEN app.candidate_id IS NOT NULL AND unk.candidate_user_id IS NOT NULL THEN 'both'
           WHEN app.candidate_id IS NOT NULL THEN 'application'
           ELSE 'unlock' END AS source,
      COALESCE(app.status, unk.lead_status, 'new') AS stage,
      COALESCE(app.job_id, unk.job_id) AS job_id,
      app.created_at AS applied_at,
      unk.unlocked_at
    FROM app
    FULL OUTER JOIN unk ON unk.candidate_user_id = app.candidate_id
  )
  SELECT
    l.candidate_id,
    l.application_id,
    l.source,
    l.stage,
    l.job_id,
    j.title,
    p.full_name,
    p.city,
    p.avatar_url,
    cp.headline,
    l.applied_at,
    l.unlocked_at,
    EXISTS (SELECT 1 FROM public.call_logs c
             WHERE c.company_id = _company_id AND c.candidate_id = l.candidate_id),
    (SELECT max(c.created_at) FROM public.call_logs c
      WHERE c.company_id = _company_id AND c.candidate_id = l.candidate_id),
    (SELECT c.outcome::text FROM public.call_logs c
      WHERE c.company_id = _company_id AND c.candidate_id = l.candidate_id
      ORDER BY c.created_at DESC LIMIT 1),
    (SELECT count(*)::int FROM public.follow_up_tasks t
      WHERE t.company_id = _company_id AND t.candidate_id = l.candidate_id
        AND t.status = 'open'),
    (SELECT min(t.due_at) FROM public.follow_up_tasks t
      WHERE t.company_id = _company_id AND t.candidate_id = l.candidate_id
        AND t.status = 'open'),
    count(*) OVER() AS total_count
  FROM leads l
  LEFT JOIN public.jobs j ON j.id = l.job_id
  LEFT JOIN public.profiles p ON p.id = l.candidate_id
  LEFT JOIN public.candidate_profiles cp ON cp.user_id = l.candidate_id
  WHERE (_job_id IS NULL OR l.job_id = _job_id)
    AND (_source IS NULL OR l.source = _source)
    AND (_stage IS NULL OR l.stage = _stage)
    AND (_contacted IS NULL
         OR EXISTS (SELECT 1 FROM public.call_logs c
                     WHERE c.company_id = _company_id
                       AND c.candidate_id = l.candidate_id) = _contacted)
  ORDER BY next_follow_up_at ASC NULLS LAST,
           COALESCE(l.applied_at, l.unlocked_at) DESC NULLS LAST
  LIMIT _limit OFFSET _offset;
END; $$;
REVOKE ALL ON FUNCTION public.get_crm_leads(uuid, uuid, text, text, boolean, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crm_leads(uuid, uuid, text, text, boolean, integer, integer) TO authenticated;

-- update_lead_status: company-scoped update of the unlock-only engagement
-- status. Targets the candidate's most recent candidate_unlocks row for this
-- company (same "most recent" convention get_crm_leads itself uses via
-- DISTINCT ON ... ORDER BY created_at DESC).
CREATE OR REPLACE FUNCTION public.update_lead_status(
  _company_id uuid,
  _candidate_user_id uuid,
  _status text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _unlock_id uuid;
BEGIN
  IF NOT public.has_company_membership(auth.uid(), _company_id) THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;
  IF _status NOT IN ('new', 'contacted', 'interested', 'follow_up_required', 'not_interested', 'unreachable') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  SELECT id INTO _unlock_id
    FROM public.candidate_unlocks
   WHERE company_id = _company_id AND candidate_user_id = _candidate_user_id
   ORDER BY created_at DESC
   LIMIT 1;

  IF _unlock_id IS NULL THEN
    RAISE EXCEPTION 'lead_not_found';
  END IF;

  UPDATE public.candidate_unlocks SET lead_status = _status WHERE id = _unlock_id;

  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'crm_lead_status_changed', 'Lead status updated',
    'Marked as ' || replace(_status, '_', ' '),
    '/employer/crm',
    jsonb_build_object('candidate_user_id', _candidate_user_id, 'status', _status)
  );
END; $$;

REVOKE ALL ON FUNCTION public.update_lead_status(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_lead_status(uuid, uuid, text) TO authenticated;
