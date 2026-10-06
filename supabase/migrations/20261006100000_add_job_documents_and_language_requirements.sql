-- Two optional job requirements shown to candidates before they apply:
--   required_documents    – extra documents/links to have ready (Portfolio, GitHub Profile, Aadhaar, Certificate).
--                           Separate from jobs.required_assets, which holds physical assets (Two-wheeler…).
--   language_requirements – repeatable [{ "language": "Hindi", "level": "fluent" }, …].
--                           Separate from jobs.preferred_languages, which has no proficiency level.
-- Additive only: existing jobs get empty values and keep working.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS required_documents text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS language_requirements jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$ BEGIN
  ALTER TABLE public.jobs
    ADD CONSTRAINT jobs_required_documents_valid
    CHECK (required_documents <@ ARRAY['Portfolio','GitHub Profile','Aadhaar','Certificate']::text[]);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.jobs
    ADD CONSTRAINT jobs_language_requirements_is_array
    CHECK (jsonb_typeof(language_requirements) = 'array');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
