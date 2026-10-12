-- Fix: admin_resolve_job_report/admin_resolve_company_report are called from
-- adminResolveReport (src/lib/admin.functions.ts) via the service-role client
-- (supabaseAdmin) — same client used by every other admin.functions.ts
-- action — but a service-role connection has no end-user session, so
-- auth.uid() is NULL there. Both RPCs' own internal
-- has_platform_role(auth.uid(), 'super_admin') check therefore always failed
-- with insufficient_permissions, even for a real super_admin, because
-- assertAdmin()'s already-correct role check (using the caller's own JWT)
-- never reaches the RPC. Fix: take the caller's identity as an explicit
-- _actor param instead, matching the convention already used by
-- apply_credit_delta/log_employer_activity/unlock_candidate elsewhere in
-- this codebase for service-role-invoked RPCs. Behavior is otherwise
-- unchanged.

DROP FUNCTION IF EXISTS public.admin_resolve_job_report(uuid, text);

CREATE FUNCTION public.admin_resolve_job_report(_report_id uuid, _action text, _actor uuid)
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
    UPDATE public.jobs SET status = 'closed', banned_at = now() WHERE id = _report.job_id;
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

REVOKE ALL ON FUNCTION public.admin_resolve_job_report(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resolve_job_report(uuid, text, uuid) TO service_role;

DROP FUNCTION IF EXISTS public.admin_resolve_company_report(uuid, text);

CREATE FUNCTION public.admin_resolve_company_report(_report_id uuid, _action text, _actor uuid)
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
      SET status = 'closed', banned_at = now()
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

REVOKE ALL ON FUNCTION public.admin_resolve_company_report(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resolve_company_report(uuid, text, uuid) TO service_role;
