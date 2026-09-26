-- Fix employer-side applicant visibility:
-- 1) applications.candidate_id only had an FK to auth.users, so PostgREST had no
--    applications -> profiles relationship for the employer-side embed queries to use.
-- 2) profiles/candidate_profiles/candidate_experiences/candidate_education/candidate_documents
--    only had "own row" RLS policies, so even a working join returned nothing for an employer.
-- Both are scoped to "this candidate applied to one of the caller's company's jobs".

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'applications_candidate_id_profiles_fkey') THEN
    ALTER TABLE public.applications
      ADD CONSTRAINT applications_candidate_id_profiles_fkey
      FOREIGN KEY (candidate_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

DROP POLICY IF EXISTS "Employers can view applicant profiles" ON public.profiles;
CREATE POLICY "Employers can view applicant profiles" ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.candidate_id = profiles.id
        AND public.has_company_membership(auth.uid(), a.company_id)
    )
  );

DROP POLICY IF EXISTS "Employers can view applicant candidate profiles" ON public.candidate_profiles;
CREATE POLICY "Employers can view applicant candidate profiles" ON public.candidate_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.candidate_id = candidate_profiles.user_id
        AND public.has_company_membership(auth.uid(), a.company_id)
    )
  );

DROP POLICY IF EXISTS "Employers can view applicant experiences" ON public.candidate_experiences;
CREATE POLICY "Employers can view applicant experiences" ON public.candidate_experiences FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.candidate_id = candidate_experiences.user_id
        AND public.has_company_membership(auth.uid(), a.company_id)
    )
  );

DROP POLICY IF EXISTS "Employers can view applicant education" ON public.candidate_education;
CREATE POLICY "Employers can view applicant education" ON public.candidate_education FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.candidate_id = candidate_education.user_id
        AND public.has_company_membership(auth.uid(), a.company_id)
    )
  );

DROP POLICY IF EXISTS "Employers can view applicant documents" ON public.candidate_documents;
CREATE POLICY "Employers can view applicant documents" ON public.candidate_documents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.candidate_id = candidate_documents.user_id
        AND public.has_company_membership(auth.uid(), a.company_id)
    )
  );

DROP POLICY IF EXISTS "candidate-docs read by hiring employer" ON storage.objects;
CREATE POLICY "candidate-docs read by hiring employer" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'candidate-docs'
    AND EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.candidate_id::text = (storage.foldername(name))[1]
        AND public.has_company_membership(auth.uid(), a.company_id)
    )
  );
