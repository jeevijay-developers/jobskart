-- Resume Builder: candidate-authored content that has no home on the profile
-- (hobbies, certifications, custom sections, summary/description overrides,
-- reusable snippets). One working draft per candidate, merged into the
-- snapshot when a version is generated. Never written back to candidate_profiles.
CREATE TABLE IF NOT EXISTS public.resume_drafts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  extras jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.resume_drafts TO authenticated;
GRANT ALL ON public.resume_drafts TO service_role;

ALTER TABLE public.resume_drafts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'resume_drafts' AND policyname = 'own resume draft'
  ) THEN
    CREATE POLICY "own resume draft" ON public.resume_drafts
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DROP TRIGGER IF EXISTS set_resume_drafts_updated_at ON public.resume_drafts;
CREATE TRIGGER set_resume_drafts_updated_at
  BEFORE UPDATE ON public.resume_drafts
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
