
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS is_consultant boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_brand_display boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS spam_suspected boolean NOT NULL DEFAULT false;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS hiring_for_company text,
  ADD COLUMN IF NOT EXISTS responses_locked_after timestamptz;

CREATE OR REPLACE FUNCTION public.tg_jobs_lock_window()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.expires_at IS NOT NULL THEN
    NEW.responses_locked_after := NEW.expires_at + interval '7 days';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_jobs_lock_window_ins ON public.jobs;
DROP TRIGGER IF EXISTS tg_jobs_lock_window_upd ON public.jobs;
CREATE TRIGGER tg_jobs_lock_window_ins BEFORE INSERT ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_jobs_lock_window();
CREATE TRIGGER tg_jobs_lock_window_upd BEFORE UPDATE OF expires_at ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_jobs_lock_window();

UPDATE public.jobs SET responses_locked_after = expires_at + interval '7 days'
  WHERE expires_at IS NOT NULL AND responses_locked_after IS NULL;

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS image_url text;

ALTER TABLE public.cities ADD COLUMN IF NOT EXISTS is_launched boolean NOT NULL DEFAULT false;
UPDATE public.cities SET is_launched = true WHERE state ILIKE 'Rajasthan';

DO $$ BEGIN CREATE TYPE public.kyc_method AS ENUM ('gst','email','manual'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.kyc_status AS ENUM ('pending','verified','rejected'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.company_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  method public.kyc_method NOT NULL,
  status public.kyc_status NOT NULL DEFAULT 'pending',
  reference text,
  docs jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  submitted_by uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_verifications TO authenticated;
GRANT ALL ON public.company_verifications TO service_role;
ALTER TABLE public.company_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cv members read" ON public.company_verifications FOR SELECT TO authenticated
  USING (public.has_company_membership(auth.uid(), company_id) OR public.has_platform_role(auth.uid(),'super_admin'));
CREATE POLICY "cv members insert" ON public.company_verifications FOR INSERT TO authenticated
  WITH CHECK (public.has_company_membership(auth.uid(), company_id));
CREATE POLICY "cv admin update" ON public.company_verifications FOR UPDATE TO authenticated
  USING (public.has_platform_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_platform_role(auth.uid(),'super_admin'));
DROP TRIGGER IF EXISTS cv_updated ON public.company_verifications;
CREATE TRIGGER cv_updated BEFORE UPDATE ON public.company_verifications
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.download_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  kind text NOT NULL,
  row_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.download_events TO authenticated;
GRANT ALL ON public.download_events TO service_role;
ALTER TABLE public.download_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "de owner read" ON public.download_events FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_platform_role(auth.uid(),'super_admin'));
CREATE POLICY "de owner insert" ON public.download_events FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.download_ledger (
  user_id uuid NOT NULL,
  kind text NOT NULL,
  day date NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, kind, day)
);
GRANT SELECT ON public.download_ledger TO authenticated;
GRANT ALL ON public.download_ledger TO service_role;
ALTER TABLE public.download_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dl owner read" ON public.download_ledger FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_platform_role(auth.uid(),'super_admin'));

CREATE OR REPLACE FUNCTION public.register_download(_company_id uuid, _kind text, _count integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _today date := (now() at time zone 'utc')::date; _new integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _count <= 0 THEN RAISE EXCEPTION 'Invalid count'; END IF;
  INSERT INTO public.download_ledger(user_id, kind, day, count) VALUES (_uid, _kind, _today, _count)
    ON CONFLICT (user_id, kind, day) DO UPDATE SET count = public.download_ledger.count + EXCLUDED.count
    RETURNING count INTO _new;
  IF _new > 300 THEN RAISE EXCEPTION 'Daily download limit (300) reached'; END IF;
  INSERT INTO public.download_events(user_id, company_id, kind, row_count)
    VALUES (_uid, _company_id, _kind, _count);
  RETURN _new;
END $$;

CREATE TABLE IF NOT EXISTS public.whatsapp_send_ledger (
  user_id uuid NOT NULL,
  day date NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
GRANT SELECT ON public.whatsapp_send_ledger TO authenticated;
GRANT ALL ON public.whatsapp_send_ledger TO service_role;
ALTER TABLE public.whatsapp_send_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wsl owner read" ON public.whatsapp_send_ledger FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_platform_role(auth.uid(),'super_admin'));

CREATE OR REPLACE FUNCTION public.register_whatsapp_send(_count integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _today date := (now() at time zone 'utc')::date; _new integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  INSERT INTO public.whatsapp_send_ledger(user_id, day, count) VALUES (_uid, _today, GREATEST(_count,1))
    ON CONFLICT (user_id, day) DO UPDATE SET count = public.whatsapp_send_ledger.count + EXCLUDED.count
    RETURNING count INTO _new;
  IF _new > 50 THEN RAISE EXCEPTION 'Daily WhatsApp send limit (50) reached'; END IF;
  RETURN _new;
END $$;

CREATE TABLE IF NOT EXISTS public.plan_settings (
  id integer PRIMARY KEY DEFAULT 1,
  free_post_enabled boolean NOT NULL DEFAULT true,
  free_response_cap integer NOT NULL DEFAULT 50,
  free_whatsapp_cap_per_post integer NOT NULL DEFAULT 500,
  free_whatsapp_rajasthan_only boolean NOT NULL DEFAULT true,
  free_validity_days integer NOT NULL DEFAULT 30,
  credits_per_unlock integer NOT NULL DEFAULT 5,
  custom_plan_min_amount integer NOT NULL DEFAULT 10000,
  spam_jobs_per_hour integer NOT NULL DEFAULT 10,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_settings_singleton CHECK (id = 1)
);
GRANT SELECT ON public.plan_settings TO authenticated, anon;
GRANT ALL ON public.plan_settings TO service_role;
ALTER TABLE public.plan_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ps read all" ON public.plan_settings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "ps admin update" ON public.plan_settings FOR UPDATE TO authenticated
  USING (public.has_platform_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_platform_role(auth.uid(),'super_admin'));
INSERT INTO public.plan_settings(id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.can_access_job_responses(_job_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT (j.responses_locked_after IS NULL OR j.responses_locked_after > now())
       AND public.has_company_membership(auth.uid(), j.company_id)
     FROM public.jobs j WHERE j.id = _job_id), false);
$$;
