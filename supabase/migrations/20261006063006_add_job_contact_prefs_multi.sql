-- Multi-select "preferred contact method" (candidate-wizard copy in JobWizard.tsx).
-- Replaces the single-value jobs.contact_pref with contact_prefs text[] so an
-- employer can pick e.g. both "Phone call" and "WhatsApp". Additive only: the old
-- column is left in place (nothing else reads it) and existing jobs are backfilled
-- from their current single value. Same shape as working_weekdays (see
-- 20261005180000_add_job_working_weekdays.sql).
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS contact_prefs text[] NOT NULL DEFAULT '{}';

UPDATE public.jobs
  SET contact_prefs = ARRAY[contact_pref]
  WHERE contact_prefs = '{}' AND contact_pref IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE public.jobs
    ADD CONSTRAINT jobs_contact_prefs_valid
    CHECK (contact_prefs <@ ARRAY['in_app','call','whatsapp']::text[]);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
