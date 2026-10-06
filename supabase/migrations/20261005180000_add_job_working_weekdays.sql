-- Which weekdays a job works (Mon–Sun multi-select in the job-posting wizard), shown on the
-- candidate job details. Additive only: existing jobs get '{}' ("not specified"), and the
-- existing integer jobs.working_days (days per week) is left untouched.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS working_weekdays text[] NOT NULL DEFAULT '{}';

DO $$ BEGIN
  ALTER TABLE public.jobs
    ADD CONSTRAINT jobs_working_weekdays_valid
    CHECK (working_weekdays <@ ARRAY['monday','tuesday','wednesday','thursday','friday','saturday','sunday']::text[]);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
