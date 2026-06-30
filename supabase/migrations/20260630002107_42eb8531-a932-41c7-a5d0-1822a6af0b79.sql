
-- 1) Activity feed
CREATE TABLE public.employer_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  link text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_employer_activity_company ON public.employer_activity(company_id, created_at DESC);

GRANT SELECT ON public.employer_activity TO authenticated;
GRANT ALL ON public.employer_activity TO service_role;
ALTER TABLE public.employer_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read activity" ON public.employer_activity
  FOR SELECT TO authenticated
  USING (public.has_company_membership(auth.uid(), company_id));

-- 2) AI shortlist scores cache
CREATE TABLE public.application_ai_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL,
  score integer NOT NULL,
  reasons text[] NOT NULL DEFAULT '{}'::text[],
  summary text,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, application_id)
);
CREATE INDEX idx_ai_scores_job ON public.application_ai_scores(job_id, score DESC);

GRANT SELECT ON public.application_ai_scores TO authenticated;
GRANT ALL ON public.application_ai_scores TO service_role;
ALTER TABLE public.application_ai_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read ai scores" ON public.application_ai_scores
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.jobs j
    WHERE j.id = application_ai_scores.job_id
      AND public.has_company_membership(auth.uid(), j.company_id)
  ));

-- 3) Helper to log
CREATE OR REPLACE FUNCTION public.log_employer_activity(
  _company_id uuid, _actor uuid, _kind text, _title text,
  _body text DEFAULT NULL, _link text DEFAULT NULL, _metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.employer_activity (company_id, actor_id, kind, title, body, link, metadata)
  VALUES (_company_id, _actor, _kind, _title, _body, _link, COALESCE(_metadata, '{}'::jsonb));
$$;

-- 4) Extend application triggers
CREATE OR REPLACE FUNCTION public.tg_applications_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _job_title text; _cand_name text;
BEGIN
  UPDATE public.jobs SET applications_count = applications_count + 1 WHERE id = NEW.job_id;
  INSERT INTO public.application_status_history(application_id, from_status, to_status, changed_by)
    VALUES (NEW.id, NULL, NEW.status, NEW.candidate_id);
  SELECT title INTO _job_title FROM public.jobs WHERE id = NEW.job_id;
  SELECT full_name INTO _cand_name FROM public.profiles WHERE id = NEW.candidate_id;
  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT em.user_id, 'application.new',
         'New application',
         'A candidate applied to "' || _job_title || '"',
         '/employer/jobs/' || NEW.job_id::text || '/applicants'
  FROM public.employer_members em WHERE em.company_id = NEW.company_id;
  PERFORM public.log_employer_activity(
    NEW.company_id, NEW.candidate_id, 'application.received',
    'New application',
    COALESCE(_cand_name, 'A candidate') || ' applied to "' || COALESCE(_job_title,'job') || '"',
    '/employer/jobs/' || NEW.job_id::text || '/applicants',
    jsonb_build_object('application_id', NEW.id, 'job_id', NEW.job_id, 'candidate_id', NEW.candidate_id)
  );
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.tg_applications_after_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _job_title text; _cand_name text;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.application_status_history(application_id, from_status, to_status, changed_by)
      VALUES (NEW.id, OLD.status, NEW.status, auth.uid());
    INSERT INTO public.notifications (user_id, type, title, body, link)
    SELECT NEW.candidate_id, 'application.status',
           'Application status updated',
           'Your application is now: ' || NEW.status,
           '/candidate/applications';
    SELECT title INTO _job_title FROM public.jobs WHERE id = NEW.job_id;
    SELECT full_name INTO _cand_name FROM public.profiles WHERE id = NEW.candidate_id;
    PERFORM public.log_employer_activity(
      NEW.company_id, auth.uid(), 'application.status_changed',
      'Application moved to ' || NEW.status,
      COALESCE(_cand_name,'Candidate') || ' on "' || COALESCE(_job_title,'job') || '"',
      '/employer/jobs/' || NEW.job_id::text || '/applicants',
      jsonb_build_object('application_id', NEW.id, 'from', OLD.status, 'to', NEW.status)
    );
  END IF;
  RETURN NEW;
END $$;

-- 5) Jobs triggers
CREATE OR REPLACE FUNCTION public.tg_jobs_activity_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.log_employer_activity(
    NEW.company_id, NEW.posted_by,
    CASE WHEN NEW.status::text = 'draft' THEN 'job.draft_saved' ELSE 'job.created' END,
    CASE WHEN NEW.status::text = 'draft' THEN 'Draft saved' ELSE 'Job posted' END,
    NEW.title,
    '/employer/jobs/' || NEW.id::text || '/applicants',
    jsonb_build_object('job_id', NEW.id, 'status', NEW.status)
  );
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS jobs_activity_insert ON public.jobs;
CREATE TRIGGER jobs_activity_insert AFTER INSERT ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_jobs_activity_insert();

CREATE OR REPLACE FUNCTION public.tg_jobs_activity_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.log_employer_activity(
      NEW.company_id, auth.uid(), 'job.status_changed',
      'Job ' || NEW.status::text,
      NEW.title,
      '/employer/jobs',
      jsonb_build_object('job_id', NEW.id, 'from', OLD.status, 'to', NEW.status)
    );
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS jobs_activity_status ON public.jobs;
CREATE TRIGGER jobs_activity_status AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_jobs_activity_status();

-- 6) Credits trigger
CREATE OR REPLACE FUNCTION public.tg_credits_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.log_employer_activity(
    NEW.company_id, NEW.created_by,
    CASE NEW.kind::text WHEN 'purchase' THEN 'credits.purchased'
                       WHEN 'unlock'   THEN 'credits.spent'
                       WHEN 'grant'    THEN 'credits.granted'
                       ELSE 'credits.adjusted' END,
    CASE NEW.kind::text WHEN 'purchase' THEN 'Credits purchased'
                       WHEN 'unlock'   THEN 'Credit spent on unlock'
                       WHEN 'grant'    THEN 'Credits granted'
                       ELSE 'Credit adjustment' END,
    (CASE WHEN NEW.delta > 0 THEN '+' ELSE '' END) || NEW.delta::text || ' credits · balance ' || NEW.balance_after::text,
    '/employer/credits',
    jsonb_build_object('delta', NEW.delta, 'kind', NEW.kind, 'reference', NEW.reference)
  );
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS credits_activity ON public.credit_transactions;
CREATE TRIGGER credits_activity AFTER INSERT ON public.credit_transactions
  FOR EACH ROW EXECUTE FUNCTION public.tg_credits_activity();

-- 7) Invites triggers
CREATE OR REPLACE FUNCTION public.tg_invites_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.log_employer_activity(
    NEW.company_id, NEW.invited_by, 'team.invited',
    'Teammate invited', NEW.email || ' as ' || NEW.role::text,
    '/employer/team',
    jsonb_build_object('invite_id', NEW.id, 'role', NEW.role)
  );
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS invites_created ON public.employer_invites;
CREATE TRIGGER invites_created AFTER INSERT ON public.employer_invites
  FOR EACH ROW EXECUTE FUNCTION public.tg_invites_created();

CREATE OR REPLACE FUNCTION public.tg_members_joined()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _name text;
BEGIN
  SELECT full_name INTO _name FROM public.profiles WHERE id = NEW.user_id;
  PERFORM public.log_employer_activity(
    NEW.company_id, NEW.user_id, 'team.joined',
    'Teammate joined', COALESCE(_name,'A teammate') || ' joined as ' || NEW.role::text,
    '/employer/team',
    jsonb_build_object('user_id', NEW.user_id, 'role', NEW.role)
  );
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS members_joined ON public.employer_members;
CREATE TRIGGER members_joined AFTER INSERT ON public.employer_members
  FOR EACH ROW EXECUTE FUNCTION public.tg_members_joined();

-- 8) Unlock trigger
CREATE OR REPLACE FUNCTION public.tg_unlock_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _name text;
BEGIN
  SELECT full_name INTO _name FROM public.profiles WHERE id = NEW.candidate_user_id;
  PERFORM public.log_employer_activity(
    NEW.company_id, NEW.unlocked_by, 'candidate.unlocked',
    'Candidate unlocked', COALESCE(_name,'A candidate') || ' contact unlocked',
    '/employer/database',
    jsonb_build_object('candidate_user_id', NEW.candidate_user_id)
  );
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS unlock_activity ON public.candidate_unlocks;
CREATE TRIGGER unlock_activity AFTER INSERT ON public.candidate_unlocks
  FOR EACH ROW EXECUTE FUNCTION public.tg_unlock_activity();

-- 9) RPC: update member role with last-admin guard
CREATE OR REPLACE FUNCTION public.update_member_role(_company_id uuid, _user_id uuid, _role employer_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _is_admin boolean; _admins int;
BEGIN
  IF NOT public.has_company_role(auth.uid(), _company_id, 'super_admin') THEN
    RAISE EXCEPTION 'Only super admins can change roles';
  END IF;
  SELECT (role = 'super_admin') INTO _is_admin FROM public.employer_members
    WHERE user_id = _user_id AND company_id = _company_id;
  IF _is_admin AND _role <> 'super_admin' THEN
    SELECT count(*) INTO _admins FROM public.employer_members
      WHERE company_id = _company_id AND role = 'super_admin';
    IF _admins <= 1 THEN RAISE EXCEPTION 'Cannot demote the last super admin'; END IF;
  END IF;
  UPDATE public.employer_members SET role = _role
    WHERE user_id = _user_id AND company_id = _company_id;
  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'team.role_changed',
    'Role updated', 'Member role set to ' || _role::text, '/employer/team',
    jsonb_build_object('user_id', _user_id, 'role', _role)
  );
END $$;

CREATE OR REPLACE FUNCTION public.remove_member(_company_id uuid, _user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _admins int; _is_admin boolean;
BEGIN
  IF NOT public.has_company_role(auth.uid(), _company_id, 'super_admin') THEN
    RAISE EXCEPTION 'Only super admins can remove members';
  END IF;
  SELECT (role = 'super_admin') INTO _is_admin FROM public.employer_members
    WHERE user_id = _user_id AND company_id = _company_id;
  IF _is_admin THEN
    SELECT count(*) INTO _admins FROM public.employer_members
      WHERE company_id = _company_id AND role = 'super_admin';
    IF _admins <= 1 THEN RAISE EXCEPTION 'Cannot remove the last super admin'; END IF;
  END IF;
  DELETE FROM public.employer_members WHERE user_id = _user_id AND company_id = _company_id;
  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'team.removed', 'Member removed', NULL, '/employer/team',
    jsonb_build_object('user_id', _user_id)
  );
END $$;
