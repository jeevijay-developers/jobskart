
-- =====================================================================
-- COMPANIES: add KYC, branding, slug, verification status
-- =====================================================================
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS cover_url text,
  ADD COLUMN IF NOT EXISTS about text,
  ADD COLUMN IF NOT EXISTS founded_year int,
  ADD COLUMN IF NOT EXISTS hq_city text,
  ADD COLUMN IF NOT EXISTS gst_number text,
  ADD COLUMN IF NOT EXISTS pan_number text,
  ADD COLUMN IF NOT EXISTS slug text UNIQUE,
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS verification_notes text,
  ADD COLUMN IF NOT EXISTS social_links jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;

-- Slugify helper
CREATE OR REPLACE FUNCTION public.slugify(_text text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(lower(trim(_text)), '[^a-z0-9]+', '-', 'g');
$$;

-- Auto-assign slug on companies
CREATE OR REPLACE FUNCTION public.tg_companies_slug()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE base text; candidate text; n int := 0;
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    base := public.slugify(NEW.name);
    candidate := base;
    WHILE EXISTS (SELECT 1 FROM public.companies WHERE slug = candidate AND id <> NEW.id) LOOP
      n := n + 1;
      candidate := base || '-' || n::text;
    END LOOP;
    NEW.slug := candidate;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS companies_set_slug ON public.companies;
CREATE TRIGGER companies_set_slug BEFORE INSERT OR UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.tg_companies_slug();

UPDATE public.companies SET slug = NULL WHERE slug IS NULL; -- triggers slug fill on next update
UPDATE public.companies SET name = name; -- force trigger to backfill slugs

-- Public read of verified companies
CREATE OR REPLACE FUNCTION public.get_public_company(_slug text)
RETURNS TABLE(
  id uuid, slug text, name text, about text, industry text,
  size public.company_size, website text, logo_url text, cover_url text,
  hq_city text, founded_year int, verification_status text, social_links jsonb
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, slug, name, about, industry, size, website, logo_url, cover_url,
         hq_city, founded_year, verification_status, social_links
  FROM public.companies
  WHERE slug = _slug
  LIMIT 1;
$$;

-- =====================================================================
-- COMPANY DOCUMENTS
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.company_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  doc_type text NOT NULL,            -- gst | pan | incorporation | other
  file_path text NOT NULL,
  file_name text,
  status text NOT NULL DEFAULT 'pending',  -- pending | verified | rejected
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_documents TO authenticated;
GRANT ALL ON public.company_documents TO service_role;
ALTER TABLE public.company_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company members manage their documents" ON public.company_documents
  FOR ALL TO authenticated
  USING (public.has_company_membership(auth.uid(), company_id))
  WITH CHECK (public.has_company_membership(auth.uid(), company_id));
CREATE TRIGGER company_documents_updated_at BEFORE UPDATE ON public.company_documents
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =====================================================================
-- EMPLOYER INVITES
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.employer_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  email text NOT NULL,
  role public.employer_role NOT NULL DEFAULT 'recruiter',
  token text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employer_invites TO authenticated;
GRANT ALL ON public.employer_invites TO service_role;
ALTER TABLE public.employer_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company members read invites" ON public.employer_invites
  FOR SELECT TO authenticated
  USING (public.has_company_membership(auth.uid(), company_id));
CREATE POLICY "Admins create invites" ON public.employer_invites
  FOR INSERT TO authenticated
  WITH CHECK (
    invited_by = auth.uid() AND (
      public.has_company_role(auth.uid(), company_id, 'super_admin') OR
      public.has_company_role(auth.uid(), company_id, 'hr_admin')
    )
  );
CREATE POLICY "Admins delete invites" ON public.employer_invites
  FOR DELETE TO authenticated
  USING (
    public.has_company_role(auth.uid(), company_id, 'super_admin') OR
    public.has_company_role(auth.uid(), company_id, 'hr_admin')
  );
CREATE POLICY "Accepter updates own invite" ON public.employer_invites
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Public read of one invite by token (for accept page)
CREATE OR REPLACE FUNCTION public.get_invite_by_token(_token text)
RETURNS TABLE(id uuid, company_id uuid, company_name text, email text, role public.employer_role, expires_at timestamptz, accepted_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.company_id, c.name AS company_name, i.email, i.role, i.expires_at, i.accepted_at
  FROM public.employer_invites i JOIN public.companies c ON c.id = i.company_id
  WHERE i.token = _token LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.accept_invite(_token text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _inv public.employer_invites%ROWTYPE; _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO _inv FROM public.employer_invites WHERE token = _token;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invite not found'; END IF;
  IF _inv.accepted_at IS NOT NULL THEN RAISE EXCEPTION 'Already accepted'; END IF;
  IF _inv.expires_at < now() THEN RAISE EXCEPTION 'Invite expired'; END IF;
  INSERT INTO public.employer_members (user_id, company_id, role)
    VALUES (_uid, _inv.company_id, _inv.role)
    ON CONFLICT (user_id, company_id) DO UPDATE SET role = EXCLUDED.role;
  UPDATE public.employer_invites SET accepted_at = now(), accepted_by = _uid WHERE id = _inv.id;
  RETURN _inv.company_id;
END; $$;

-- =====================================================================
-- NOTIFICATIONS
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_unread ON public.notifications(user_id, created_at DESC) WHERE read_at IS NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own notifications" ON public.notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users update own notifications" ON public.notifications
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users delete own notifications" ON public.notifications
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- =====================================================================
-- JOBS: status, slug, counters, screening questions, featured
-- =====================================================================
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS views_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS applications_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS screening_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS slug text;

CREATE OR REPLACE FUNCTION public.tg_jobs_slug()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE base text; candidate text; n int := 0;
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    base := public.slugify(COALESCE(NEW.title, 'job')) || '-' || substr(replace(NEW.id::text,'-',''),1,6);
    NEW.slug := base;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS jobs_set_slug ON public.jobs;
CREATE TRIGGER jobs_set_slug BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_jobs_slug();
UPDATE public.jobs SET slug = NULL WHERE slug IS NULL;
UPDATE public.jobs SET title = title;

-- =====================================================================
-- APPLICATION NOTES + HISTORY
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.application_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.application_notes TO authenticated;
GRANT ALL ON public.application_notes TO service_role;
ALTER TABLE public.application_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company members read notes" ON public.application_notes
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.applications a JOIN public.jobs j ON j.id = a.job_id
      WHERE a.id = application_id AND public.has_company_membership(auth.uid(), j.company_id)
    )
  );
CREATE POLICY "Company members write notes" ON public.application_notes
  FOR INSERT TO authenticated WITH CHECK (
    author_id = auth.uid() AND EXISTS (
      SELECT 1 FROM public.applications a JOIN public.jobs j ON j.id = a.job_id
      WHERE a.id = application_id AND public.has_company_membership(auth.uid(), j.company_id)
    )
  );
CREATE POLICY "Author deletes own note" ON public.application_notes
  FOR DELETE TO authenticated USING (author_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.application_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  changed_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.application_status_history TO authenticated;
GRANT ALL ON public.application_status_history TO service_role;
ALTER TABLE public.application_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members and applicant read history" ON public.application_status_history
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.applications a JOIN public.jobs j ON j.id = a.job_id
      WHERE a.id = application_id AND (
        a.candidate_id = auth.uid() OR public.has_company_membership(auth.uid(), j.company_id)
      )
    )
  );

-- Triggers: maintain counters + history
CREATE OR REPLACE FUNCTION public.tg_applications_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.jobs SET applications_count = applications_count + 1 WHERE id = NEW.job_id;
  INSERT INTO public.application_status_history(application_id, from_status, to_status, changed_by)
    VALUES (NEW.id, NULL, NEW.status, NEW.candidate_id);
  -- Notify employer (any super_admin/hr_admin of company)
  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT em.user_id, 'application.new',
         'New application',
         'A candidate applied to "' || j.title || '"',
         '/employer/jobs/' || j.id::text || '/applicants'
  FROM public.jobs j
  JOIN public.employer_members em ON em.company_id = j.company_id
  WHERE j.id = NEW.job_id;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS applications_after_insert ON public.applications;
CREATE TRIGGER applications_after_insert AFTER INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.tg_applications_after_insert();

CREATE OR REPLACE FUNCTION public.tg_applications_after_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.application_status_history(application_id, from_status, to_status, changed_by)
      VALUES (NEW.id, OLD.status, NEW.status, auth.uid());
    INSERT INTO public.notifications (user_id, type, title, body, link)
    SELECT NEW.candidate_id, 'application.status',
           'Application status updated',
           'Your application is now: ' || NEW.status,
           '/candidate/applications';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS applications_after_update ON public.applications;
CREATE TRIGGER applications_after_update AFTER UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.tg_applications_after_update();

-- =====================================================================
-- CONTACT MESSAGES
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.contact_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  subject text,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT INSERT ON public.contact_messages TO anon, authenticated;
GRANT ALL ON public.contact_messages TO service_role;
ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can submit contact message" ON public.contact_messages
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- =====================================================================
-- STORAGE POLICIES
-- =====================================================================
-- company-logos (private bucket; signed URLs)
CREATE POLICY "Company members read logos" ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'company-logos' AND (
      EXISTS (
        SELECT 1 FROM public.companies c
        WHERE c.id::text = (storage.foldername(name))[1]
          AND public.has_company_membership(auth.uid(), c.id)
      )
    )
  );
CREATE POLICY "Company members write logos" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'company-logos' AND EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id::text = (storage.foldername(name))[1]
        AND public.has_company_membership(auth.uid(), c.id)
    )
  );
CREATE POLICY "Company members update logos" ON storage.objects
  FOR UPDATE TO authenticated USING (
    bucket_id = 'company-logos' AND EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id::text = (storage.foldername(name))[1]
        AND public.has_company_membership(auth.uid(), c.id)
    )
  );
CREATE POLICY "Company members delete logos" ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'company-logos' AND EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id::text = (storage.foldername(name))[1]
        AND public.has_company_membership(auth.uid(), c.id)
    )
  );

-- company-docs
CREATE POLICY "Members read company docs" ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'company-docs' AND EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id::text = (storage.foldername(name))[1]
        AND public.has_company_membership(auth.uid(), c.id)
    )
  );
CREATE POLICY "Members write company docs" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'company-docs' AND EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id::text = (storage.foldername(name))[1]
        AND public.has_company_membership(auth.uid(), c.id)
    )
  );
CREATE POLICY "Members delete company docs" ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'company-docs' AND EXISTS (
      SELECT 1 FROM public.companies c
      WHERE c.id::text = (storage.foldername(name))[1]
        AND public.has_company_membership(auth.uid(), c.id)
    )
  );
