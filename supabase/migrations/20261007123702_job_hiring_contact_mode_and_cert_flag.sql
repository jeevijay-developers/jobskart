-- Job Wizard Requirements-step mandatory-fields change:
--   hiring_contact_mode: "myself" | "other" — which hiring-contact UI path
--     the recruiter chose ("Yes, to myself" pre-fills from their own
--     profile; "Yes, to other recruiter" is manual entry).
--   certifications_not_required: the explicit "No certification required"
--     opt-out, so Certifications can be a mandatory field without forcing a
--     fake tag onto jobs that genuinely need none.
-- Additive, re-runnable.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS hiring_contact_mode text,
  ADD COLUMN IF NOT EXISTS certifications_not_required boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE public.jobs
    ADD CONSTRAINT jobs_hiring_contact_mode_valid
    CHECK (hiring_contact_mode IS NULL OR hiring_contact_mode IN ('myself', 'other'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
