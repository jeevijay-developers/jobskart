
-- 1) Interviews
CREATE TYPE public.interview_mode AS ENUM ('video','phone','onsite');
CREATE TYPE public.interview_status AS ENUM ('scheduled','confirmed','rescheduled','cancelled','completed');

CREATE TABLE public.interviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid REFERENCES public.applications(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  mode public.interview_mode NOT NULL DEFAULT 'video',
  scheduled_at timestamptz NOT NULL,
  duration_min int NOT NULL DEFAULT 30,
  location text,
  meeting_url text,
  notes text,
  status public.interview_status NOT NULL DEFAULT 'scheduled',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.interviews TO authenticated;
GRANT ALL ON public.interviews TO service_role;
ALTER TABLE public.interviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "candidate reads own interviews" ON public.interviews
  FOR SELECT TO authenticated USING (candidate_id = auth.uid());
CREATE POLICY "company members read interviews" ON public.interviews
  FOR SELECT TO authenticated USING (public.has_company_membership(auth.uid(), company_id));
CREATE POLICY "company members write interviews" ON public.interviews
  FOR ALL TO authenticated
  USING (public.has_company_membership(auth.uid(), company_id))
  WITH CHECK (public.has_company_membership(auth.uid(), company_id));

CREATE TRIGGER trg_interviews_updated BEFORE UPDATE ON public.interviews
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE OR REPLACE FUNCTION public.tg_interviews_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _job_title text;
BEGIN
  SELECT title INTO _job_title FROM public.jobs WHERE id = NEW.job_id;
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (NEW.candidate_id, 'interview.scheduled',
          'Interview scheduled',
          COALESCE(_job_title,'A role') || ' · ' || to_char(NEW.scheduled_at, 'DD Mon, HH24:MI'),
          '/candidate/interviews');
  PERFORM public.log_employer_activity(
    NEW.company_id, NEW.created_by, 'interview.scheduled',
    'Interview scheduled', COALESCE(_job_title,'') || ' · ' || to_char(NEW.scheduled_at, 'DD Mon, HH24:MI'),
    '/employer/interviews',
    jsonb_build_object('interview_id', NEW.id, 'application_id', NEW.application_id));
  RETURN NEW;
END $$;

CREATE TRIGGER trg_interviews_notify AFTER INSERT ON public.interviews
  FOR EACH ROW EXECUTE FUNCTION public.tg_interviews_notify();

-- 2) Match scores
CREATE TABLE public.application_match_scores (
  application_id uuid PRIMARY KEY REFERENCES public.applications(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  job_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  score int,
  strengths jsonb DEFAULT '[]'::jsonb,
  gaps jsonb DEFAULT '[]'::jsonb,
  summary text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.application_match_scores TO authenticated;
GRANT ALL ON public.application_match_scores TO service_role;
ALTER TABLE public.application_match_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company members read scores" ON public.application_match_scores
  FOR SELECT TO authenticated USING (public.has_company_membership(auth.uid(), company_id));
CREATE POLICY "candidate reads own score" ON public.application_match_scores
  FOR SELECT TO authenticated USING (candidate_id = auth.uid());

CREATE TRIGGER trg_match_scores_updated BEFORE UPDATE ON public.application_match_scores
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 3) Job alerts
CREATE TABLE public.candidate_job_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  query jsonb NOT NULL DEFAULT '{}'::jsonb,
  frequency text NOT NULL DEFAULT 'daily',
  whatsapp_enabled boolean NOT NULL DEFAULT false,
  email_enabled boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  last_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidate_job_alerts TO authenticated;
GRANT ALL ON public.candidate_job_alerts TO service_role;
ALTER TABLE public.candidate_job_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own alerts" ON public.candidate_job_alerts
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TRIGGER trg_alerts_updated BEFORE UPDATE ON public.candidate_job_alerts
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 4) Job column
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS auto_shortlist_threshold int;
