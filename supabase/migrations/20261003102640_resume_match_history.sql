-- Score history for the resume builder's "Tailor to a job" check. Candidate-owned
-- only: each row is written by the candidate for their own resume check and is
-- never read by employers or other candidates. Re-runnable.

CREATE TABLE IF NOT EXISTS public.resume_match_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- NULL for checks against a pasted job description (there is no job row).
  job_id uuid REFERENCES public.jobs(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT '',
  score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  matched_count integer NOT NULL DEFAULT 0 CHECK (matched_count >= 0),
  total_count integer NOT NULL DEFAULT 0 CHECK (total_count >= matched_count),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS resume_match_history_user_job_idx
  ON public.resume_match_history (user_id, job_id, created_at DESC);

ALTER TABLE public.resume_match_history ENABLE ROW LEVEL SECURITY;

-- Table grants are needed on top of RLS: the authenticated role has no privilege
-- on this table until it is granted (RLS alone only filters rows).
GRANT SELECT, INSERT, DELETE ON public.resume_match_history TO authenticated;
GRANT ALL ON public.resume_match_history TO service_role;

DROP POLICY IF EXISTS "owner select own match history" ON public.resume_match_history;
CREATE POLICY "owner select own match history" ON public.resume_match_history
  FOR SELECT TO authenticated USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "owner insert own match history" ON public.resume_match_history;
CREATE POLICY "owner insert own match history" ON public.resume_match_history
  FOR INSERT TO authenticated WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "owner delete own match history" ON public.resume_match_history;
CREATE POLICY "owner delete own match history" ON public.resume_match_history
  FOR DELETE TO authenticated USING (user_id = (select auth.uid()));
