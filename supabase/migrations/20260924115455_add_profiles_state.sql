-- Candidate onboarding now captures State alongside the existing City field.
-- Additive only: does not touch or rename the existing profiles.city column.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS state text;
