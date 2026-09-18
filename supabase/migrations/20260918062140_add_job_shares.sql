-- Tracks candidate "Share" actions on a job, mirroring the shape of
-- saved_jobs (job-scoped, candidate-writable) but append-only since a
-- candidate can share the same job more than once (no unique constraint).
CREATE TABLE IF NOT EXISTS public.job_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  channel text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_shares_job ON public.job_shares(job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_shares_user ON public.job_shares(user_id, created_at DESC);

ALTER TABLE public.job_shares ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.job_shares TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'job_shares' AND policyname = 'candidate insert own share'
  ) THEN
    CREATE POLICY "candidate insert own share" ON public.job_shares
      FOR INSERT TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'job_shares' AND policyname = 'candidate read own shares'
  ) THEN
    CREATE POLICY "candidate read own shares" ON public.job_shares
      FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;
