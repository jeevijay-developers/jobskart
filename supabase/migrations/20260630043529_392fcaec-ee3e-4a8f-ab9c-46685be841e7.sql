
CREATE TABLE public.job_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  reporter_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text NOT NULL,
  details text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.job_reports TO authenticated;
GRANT INSERT ON public.job_reports TO anon;
GRANT ALL ON public.job_reports TO service_role;

ALTER TABLE public.job_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can submit a job report"
  ON public.job_reports FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Reporters can view their own reports"
  ON public.job_reports FOR SELECT
  TO authenticated
  USING (reporter_id = auth.uid());

CREATE POLICY "Super admins can view all reports"
  ON public.job_reports FOR SELECT
  TO authenticated
  USING (public.has_platform_role(auth.uid(), 'super_admin'));

CREATE POLICY "Super admins can update reports"
  ON public.job_reports FOR UPDATE
  TO authenticated
  USING (public.has_platform_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_platform_role(auth.uid(), 'super_admin'));

CREATE INDEX idx_job_reports_job_id ON public.job_reports(job_id);
CREATE INDEX idx_job_reports_status ON public.job_reports(status);

CREATE TRIGGER trg_job_reports_updated_at
  BEFORE UPDATE ON public.job_reports
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
