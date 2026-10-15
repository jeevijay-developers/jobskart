-- Makes Ban/Flag on the Reports admin page reversible. Banning closes a job
-- (status='closed') and the existing code threw away what the job's status
-- was before that — unbanning needs to restore the real prior state
-- (active vs paused), not just assume 'active'. A company ban also cascades
-- to close all its active/paused jobs; unbanning the company must reopen
-- only the jobs THAT cascade closed, not jobs already closed for unrelated
-- reasons, and not a job that was separately, directly banned on its own
-- report (which should stay closed on its own merits).

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS status_before_ban public.job_status,
  ADD COLUMN IF NOT EXISTS banned_by_company_ban boolean NOT NULL DEFAULT false;

-- ── admin_resolve_job_report: capture status_before_ban on the 'banned' branch ──
CREATE OR REPLACE FUNCTION public.admin_resolve_job_report(_report_id uuid, _action text, _actor uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _report public.job_reports%ROWTYPE;
  _company_id uuid;
  _job_title text;
BEGIN
  IF NOT public.has_platform_role(_actor, 'super_admin') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  IF _action NOT IN ('dismissed', 'flagged', 'banned') THEN
    RAISE EXCEPTION 'invalid_action';
  END IF;

  SELECT * INTO _report FROM public.job_reports WHERE id = _report_id FOR UPDATE;
  IF _report IS NULL THEN
    RAISE EXCEPTION 'report_not_found';
  END IF;

  SELECT company_id, title INTO _company_id, _job_title FROM public.jobs WHERE id = _report.job_id;

  UPDATE public.job_reports
    SET status = _action, resolved_by = _actor, resolved_at = now()
    WHERE id = _report_id;

  IF _action = 'flagged' THEN
    UPDATE public.jobs SET flagged_at = COALESCE(flagged_at, now()) WHERE id = _report.job_id;
  ELSIF _action = 'banned' THEN
    UPDATE public.jobs
      SET status_before_ban = COALESCE(status_before_ban, status),
          status = 'closed', banned_at = now()
      WHERE id = _report.job_id;
    IF _company_id IS NOT NULL THEN
      PERFORM public.log_employer_activity(
        _company_id, _actor, 'job.banned', 'Job removed',
        COALESCE(_job_title, 'A job posting') || ' was removed for a policy violation.',
        '/employer/jobs',
        jsonb_build_object('job_id', _report.job_id)
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('report_id', _report_id, 'action', _action);
END; $$;

-- ── admin_resolve_company_report: capture status_before_ban + provenance on cascade ──
CREATE OR REPLACE FUNCTION public.admin_resolve_company_report(_report_id uuid, _action text, _actor uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _report public.company_reports%ROWTYPE;
BEGIN
  IF NOT public.has_platform_role(_actor, 'super_admin') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  IF _action NOT IN ('dismissed', 'flagged', 'banned') THEN
    RAISE EXCEPTION 'invalid_action';
  END IF;

  SELECT * INTO _report FROM public.company_reports WHERE id = _report_id FOR UPDATE;
  IF _report IS NULL THEN
    RAISE EXCEPTION 'report_not_found';
  END IF;

  UPDATE public.company_reports
    SET status = _action, resolved_by = _actor, resolved_at = now()
    WHERE id = _report_id;

  IF _action = 'flagged' THEN
    UPDATE public.companies SET spam_suspected = true WHERE id = _report.company_id;
  ELSIF _action = 'banned' THEN
    UPDATE public.companies SET banned_at = now() WHERE id = _report.company_id;
    UPDATE public.jobs
      SET status_before_ban = COALESCE(status_before_ban, status),
          banned_by_company_ban = true,
          status = 'closed', banned_at = now()
      WHERE company_id = _report.company_id AND status IN ('active', 'paused');

    PERFORM public.log_employer_activity(
      _report.company_id, _actor, 'company.banned', 'Company account banned',
      'This company account was banned for a policy violation. All job posts were closed.',
      '/employer/dashboard',
      jsonb_build_object('company_id', _report.company_id)
    );
  END IF;

  RETURN jsonb_build_object('report_id', _report_id, 'action', _action);
END; $$;

-- ── admin_reverse_job_report ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_reverse_job_report(_report_id uuid, _actor uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _report public.job_reports%ROWTYPE;
  _company_id uuid;
  _job_title text;
BEGIN
  IF NOT public.has_platform_role(_actor, 'super_admin') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  SELECT * INTO _report FROM public.job_reports WHERE id = _report_id FOR UPDATE;
  IF _report IS NULL THEN
    RAISE EXCEPTION 'report_not_found';
  END IF;
  IF _report.status NOT IN ('flagged', 'banned') THEN
    RAISE EXCEPTION 'nothing_to_reverse';
  END IF;

  SELECT company_id, title INTO _company_id, _job_title FROM public.jobs WHERE id = _report.job_id;

  IF _report.status = 'flagged' THEN
    UPDATE public.jobs SET flagged_at = NULL WHERE id = _report.job_id;
  ELSIF _report.status = 'banned' THEN
    UPDATE public.jobs
      SET status = COALESCE(status_before_ban, 'active'),
          status_before_ban = NULL, banned_at = NULL, banned_by_company_ban = false
      WHERE id = _report.job_id;
    IF _company_id IS NOT NULL THEN
      PERFORM public.log_employer_activity(
        _company_id, _actor, 'job.restored', 'Job restored',
        COALESCE(_job_title, 'A job posting') || ' was restored by a platform admin.',
        '/employer/jobs',
        jsonb_build_object('job_id', _report.job_id)
      );
    END IF;
  END IF;

  UPDATE public.job_reports
    SET status = 'open', resolved_by = NULL, resolved_at = NULL
    WHERE id = _report_id;

  RETURN jsonb_build_object('report_id', _report_id, 'action', 'reversed');
END; $$;

REVOKE ALL ON FUNCTION public.admin_reverse_job_report(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reverse_job_report(uuid, uuid) TO service_role;

-- ── admin_reverse_company_report ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_reverse_company_report(_report_id uuid, _actor uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _report public.company_reports%ROWTYPE;
BEGIN
  IF NOT public.has_platform_role(_actor, 'super_admin') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  SELECT * INTO _report FROM public.company_reports WHERE id = _report_id FOR UPDATE;
  IF _report IS NULL THEN
    RAISE EXCEPTION 'report_not_found';
  END IF;
  IF _report.status NOT IN ('flagged', 'banned') THEN
    RAISE EXCEPTION 'nothing_to_reverse';
  END IF;

  IF _report.status = 'flagged' THEN
    UPDATE public.companies SET spam_suspected = false WHERE id = _report.company_id;
  ELSIF _report.status = 'banned' THEN
    UPDATE public.companies SET banned_at = NULL WHERE id = _report.company_id;
    UPDATE public.jobs
      SET status = COALESCE(status_before_ban, 'active'),
          status_before_ban = NULL, banned_at = NULL, banned_by_company_ban = false
      WHERE company_id = _report.company_id AND banned_by_company_ban = true;

    PERFORM public.log_employer_activity(
      _report.company_id, _actor, 'company.unbanned', 'Company account unbanned',
      'This company account was restored by a platform admin. Its job posts were reopened.',
      '/employer/dashboard',
      jsonb_build_object('company_id', _report.company_id)
    );
  END IF;

  UPDATE public.company_reports
    SET status = 'open', resolved_by = NULL, resolved_at = NULL
    WHERE id = _report_id;

  RETURN jsonb_build_object('report_id', _report_id, 'action', 'reversed');
END; $$;

REVOKE ALL ON FUNCTION public.admin_reverse_company_report(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reverse_company_report(uuid, uuid) TO service_role;
