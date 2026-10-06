-- Optional hiring contact the employer chooses to show candidates on the job page.
-- Additive only: existing jobs get NULL ("no contact shown").
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS hiring_contact_name text,
  ADD COLUMN IF NOT EXISTS hiring_contact_phone text,
  ADD COLUMN IF NOT EXISTS hiring_contact_email text;
