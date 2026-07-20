
-- pan india on jobs
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS pan_india_ok boolean NOT NULL DEFAULT false;

-- Plans catalog
CREATE TABLE IF NOT EXISTS public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  price_inr integer NOT NULL DEFAULT 0,
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_custom boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.plans TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.plans TO authenticated;
GRANT ALL ON public.plans TO service_role;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plans read all" ON public.plans FOR SELECT USING (true);
CREATE POLICY "plans admin write" ON public.plans FOR ALL TO authenticated
  USING (public.has_platform_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_platform_role(auth.uid(), 'super_admin'));
CREATE TRIGGER trg_plans_updated BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Match scoring config singleton
CREATE TABLE IF NOT EXISTS public.match_scoring_config (
  id integer PRIMARY KEY DEFAULT 1,
  weights jsonb NOT NULL DEFAULT '{"skills":0.4,"experience":0.3,"location":0.2,"salary":0.1}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_scoring_config_singleton CHECK (id = 1)
);
GRANT SELECT ON public.match_scoring_config TO anon, authenticated;
GRANT INSERT, UPDATE ON public.match_scoring_config TO authenticated;
GRANT ALL ON public.match_scoring_config TO service_role;
ALTER TABLE public.match_scoring_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "msc read" ON public.match_scoring_config FOR SELECT USING (true);
CREATE POLICY "msc admin write" ON public.match_scoring_config FOR ALL TO authenticated
  USING (public.has_platform_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_platform_role(auth.uid(), 'super_admin'));
INSERT INTO public.match_scoring_config (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Extend plan_settings
ALTER TABLE public.plan_settings
  ADD COLUMN IF NOT EXISTS free_post_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS free_response_cap integer DEFAULT 50,
  ADD COLUMN IF NOT EXISTS free_whatsapp_per_post integer DEFAULT 500,
  ADD COLUMN IF NOT EXISTS free_plan_validity_days integer DEFAULT 30;

-- Add image_url to notifications if missing
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS image_url text;

-- Approve/reject verification helper
CREATE OR REPLACE FUNCTION public.admin_set_verification(_id uuid, _status text, _notes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _cid uuid;
BEGIN
  IF NOT public.has_platform_role(auth.uid(), 'super_admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  UPDATE public.company_verifications SET status = _status, notes = COALESCE(_notes, notes), reviewed_by = auth.uid(), reviewed_at = now()
    WHERE id = _id RETURNING company_id INTO _cid;
  IF _status = 'verified' THEN
    UPDATE public.companies SET verification_status = 'verified' WHERE id = _cid;
  ELSIF _status = 'rejected' THEN
    UPDATE public.companies SET verification_status = 'rejected' WHERE id = _cid;
  END IF;
END $$;

-- Bulk launch cities by state
CREATE OR REPLACE FUNCTION public.admin_launch_state(_state text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _n integer;
BEGIN
  IF NOT public.has_platform_role(auth.uid(), 'super_admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  UPDATE public.cities SET is_launched = true WHERE lower(state) = lower(_state);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;
