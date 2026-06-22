ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS mobile_verified boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS signup_intent text;