
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS industry text,
  ADD COLUMN IF NOT EXISTS pay_type text DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS avg_incentive_monthly integer,
  ADD COLUMN IF NOT EXISTS interview_type text,
  ADD COLUMN IF NOT EXISTS interview_same_as_company boolean,
  ADD COLUMN IF NOT EXISTS interview_city text,
  ADD COLUMN IF NOT EXISTS interview_locality text,
  ADD COLUMN IF NOT EXISTS interview_address text,
  ADD COLUMN IF NOT EXISTS experience_bucket text DEFAULT 'any',
  ADD COLUMN IF NOT EXISTS preferred_languages text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS required_assets text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS degree text,
  ADD COLUMN IF NOT EXISTS specialisation text,
  ADD COLUMN IF NOT EXISTS certifications text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS preferred_industries text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS joining_fee_required boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS working_days integer,
  ADD COLUMN IF NOT EXISTS description_html text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='jobs_pay_type_check') THEN
    ALTER TABLE public.jobs ADD CONSTRAINT jobs_pay_type_check CHECK (pay_type IN ('fixed','fixed_incentive','incentive_only'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='jobs_interview_type_check') THEN
    ALTER TABLE public.jobs ADD CONSTRAINT jobs_interview_type_check CHECK (interview_type IS NULL OR interview_type IN ('in_person','telephonic'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='jobs_experience_bucket_check') THEN
    ALTER TABLE public.jobs ADD CONSTRAINT jobs_experience_bucket_check CHECK (experience_bucket IN ('any','fresher','experienced'));
  END IF;
END $$;
