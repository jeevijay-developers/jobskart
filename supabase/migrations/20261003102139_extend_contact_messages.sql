ALTER TABLE public.contact_messages
  ADD COLUMN IF NOT EXISTS audience text,
  ADD COLUMN IF NOT EXISTS subject text;
