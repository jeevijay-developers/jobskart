-- Fix: "Unable to save resume version" on /candidate/resume-builder — the
-- Resume Builder's POST /api/resume-builder handler (src/routes/api/resume-builder.ts)
-- and the page's loadVersions() (src/routes/_authenticated/candidate/resume-builder.tsx)
-- both assume a public.resume_versions table already exists, but no prior
-- migration ever created it (confirmed live: PostgREST returns
-- "Could not find the table 'public.resume_versions' in the schema cache").
-- Generating a resume snapshot/preview never touches this table (that's the
-- GET flow, already working), only the save step does — matching the
-- reported symptom exactly.
--
-- Columns match what the existing code already reads/writes verbatim
-- (ResumeVersion type in src/lib/resumeBuilder/types.ts, the insert in the
-- POST handler, and the id/version_number/template_id/created_at columns
-- selected by loadVersions()). No application code changes required.

CREATE TABLE IF NOT EXISTS public.resume_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  snapshot jsonb NOT NULL,
  template_id text NOT NULL,
  version_number integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, version_number)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.resume_versions TO authenticated;
GRANT ALL ON public.resume_versions TO service_role;

ALTER TABLE public.resume_versions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'resume_versions' AND policyname = 'own resume versions'
  ) THEN
    CREATE POLICY "own resume versions" ON public.resume_versions
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_resume_versions_user_id ON public.resume_versions (user_id, version_number DESC);
