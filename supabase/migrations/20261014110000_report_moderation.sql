-- Candidate-facing report/flag for jobs and companies, reviewed and resolved
-- only by the platform Super Admin (platform_roles, never the company's own
-- employer_members) — see CLAUDE.md rbac.md: two independent, non-overlapping
-- role systems.
--
-- job_reports already existed (candidate insert + super_admin read/update via
-- RLS) but nothing on the admin side ever consumed it. This migration adds
-- the resolution bookkeeping to job_reports, a parallel company_reports
-- table, ban/flag markers on jobs/companies, and the two resolution RPCs.

-- ── 1. job_reports: add resolution bookkeeping ─────────────────────────────
ALTER TABLE public.job_reports
  ADD COLUMN IF NOT EXISTS resolved_by uuid,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
-- status stays free text; terminal values become 'dismissed' | 'flagged' | 'banned'.

-- ── 2. company_reports: parallel table, same shape/RLS as job_reports ─────
CREATE TABLE IF NOT EXISTS public.company_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  reporter_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text NOT NULL,
  details text,
  status text NOT NULL DEFAULT 'open',
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.company_reports TO authenticated;
GRANT ALL ON public.company_reports TO service_role;

ALTER TABLE public.company_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users can report a company" ON public.company_reports
  FOR INSERT TO authenticated
  WITH CHECK (
    reporter_id = auth.uid()
    AND char_length(reason) BETWEEN 2 AND 200
    AND (details IS NULL OR char_length(details) <= 2000)
  );

CREATE POLICY "Reporters can view their own company reports"
  ON public.company_reports FOR SELECT
  TO authenticated
  USING (reporter_id = auth.uid());

CREATE POLICY "Super admins can view all company reports"
  ON public.company_reports FOR SELECT
  TO authenticated
  USING (public.has_platform_role(auth.uid(), 'super_admin'));

CREATE POLICY "Super admins can update company reports"
  ON public.company_reports FOR UPDATE
  TO authenticated
  USING (public.has_platform_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_platform_role(auth.uid(), 'super_admin'));

CREATE INDEX IF NOT EXISTS idx_company_reports_company_id ON public.company_reports(company_id);
CREATE INDEX IF NOT EXISTS idx_company_reports_status ON public.company_reports(status);

CREATE TRIGGER trg_company_reports_updated_at
  BEFORE UPDATE ON public.company_reports
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ── 3. Ban/flag markers ─────────────────────────────────────────────────────
-- Plain nullable columns, not new job_status enum values: avoids ALTER TYPE's
-- same-transaction restrictions, and keeps "flagged for review" distinct from
-- an employer's own ordinary pause/close.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS flagged_at timestamptz,
  ADD COLUMN IF NOT EXISTS banned_at timestamptz;

-- companies.spam_suspected already exists (20260719064619) and already has a
-- real consumer (the interview-scheduling guard) — reused here as "flagged"
-- rather than adding a redundant column.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS banned_at timestamptz;

-- ── 4. admin_resolve_job_report ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_resolve_job_report(_report_id uuid, _action text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _report public.job_reports%ROWTYPE;
  _company_id uuid;
  _job_title text;
BEGIN
  IF NOT public.has_platform_role(auth.uid(), 'super_admin') THEN
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
    SET status = _action, resolved_by = auth.uid(), resolved_at = now()
    WHERE id = _report_id;

  IF _action = 'flagged' THEN
    UPDATE public.jobs SET flagged_at = COALESCE(flagged_at, now()) WHERE id = _report.job_id;
  ELSIF _action = 'banned' THEN
    UPDATE public.jobs SET status = 'closed', banned_at = now() WHERE id = _report.job_id;
    IF _company_id IS NOT NULL THEN
      PERFORM public.log_employer_activity(
        _company_id, auth.uid(), 'job.banned', 'Job removed',
        COALESCE(_job_title, 'A job posting') || ' was removed for a policy violation.',
        '/employer/jobs',
        jsonb_build_object('job_id', _report.job_id)
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('report_id', _report_id, 'action', _action);
END; $$;

REVOKE ALL ON FUNCTION public.admin_resolve_job_report(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resolve_job_report(uuid, text) TO service_role;

-- ── 5. admin_resolve_company_report ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_resolve_company_report(_report_id uuid, _action text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _report public.company_reports%ROWTYPE;
BEGIN
  IF NOT public.has_platform_role(auth.uid(), 'super_admin') THEN
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
    SET status = _action, resolved_by = auth.uid(), resolved_at = now()
    WHERE id = _report_id;

  IF _action = 'flagged' THEN
    UPDATE public.companies SET spam_suspected = true WHERE id = _report.company_id;
  ELSIF _action = 'banned' THEN
    UPDATE public.companies SET banned_at = now() WHERE id = _report.company_id;
    UPDATE public.jobs
      SET status = 'closed', banned_at = now()
      WHERE company_id = _report.company_id AND status IN ('active', 'paused');

    PERFORM public.log_employer_activity(
      _report.company_id, auth.uid(), 'company.banned', 'Company account banned',
      'This company account was banned for a policy violation. All job posts were closed.',
      '/employer/dashboard',
      jsonb_build_object('company_id', _report.company_id)
    );
  END IF;

  RETURN jsonb_build_object('report_id', _report_id, 'action', _action);
END; $$;

REVOKE ALL ON FUNCTION public.admin_resolve_company_report(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resolve_company_report(uuid, text) TO service_role;
