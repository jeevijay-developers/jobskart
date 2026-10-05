-- WhatsApp-centric UX, Phase 1 (consent/preference foundation) + Phase 2 schema
-- (template catalog, message outbox/log) from whatsapp-centric-ux-implementation-improved.md.
-- No provider secrets or sending logic here — this migration only lands schema,
-- defaults, and the Postgres-side guardrails (consent, caps). See that doc for
-- the full design (D1-D12).

-- ---------------------------------------------------------------------------
-- 2.3 contradiction fixes
-- ---------------------------------------------------------------------------

-- Duplicate cap column from an earlier iterative migration; free_whatsapp_cap_per_post
-- (20260719064619) is the one actually read by admin/plans.tsx and enforced below.
ALTER TABLE public.plan_settings DROP COLUMN IF EXISTS free_whatsapp_per_post;

-- "Default opt-in everywhere a subscription is created" (D3): new alert rows and
-- new candidate_profiles rows should default to WhatsApp on, matching
-- candidate_profiles.whatsapp_opt_in's existing DEFAULT true. Existing rows are
-- backfilled below only where the candidate already has a number and has opted in,
-- so this never silently opts in someone who explicitly said no.
ALTER TABLE public.candidate_job_alerts ALTER COLUMN whatsapp_enabled SET DEFAULT true;
ALTER TABLE public.candidate_profiles ALTER COLUMN notification_prefs
  SET DEFAULT '{"email_alerts":true,"whatsapp_alerts":true,"weekly_digest":true}'::jsonb;

UPDATE public.candidate_job_alerts a SET whatsapp_enabled = true
 WHERE whatsapp_enabled = false
   AND EXISTS (
     SELECT 1 FROM public.candidate_profiles p
     WHERE p.user_id = a.user_id AND p.whatsapp_opt_in AND p.whatsapp_number IS NOT NULL
   );

-- Number health, tracked separately from consent (D7): consent says "may we send
-- you WhatsApp", this says "does the number currently accept messages". A
-- provider-reported invalid number suppresses sends without touching consent.
ALTER TABLE public.candidate_profiles ADD COLUMN IF NOT EXISTS whatsapp_number_status
  text NOT NULL DEFAULT 'unverified';
ALTER TABLE public.candidate_profiles DROP CONSTRAINT IF EXISTS candidate_profiles_whatsapp_number_status_check;
ALTER TABLE public.candidate_profiles ADD CONSTRAINT candidate_profiles_whatsapp_number_status_check
  CHECK (whatsapp_number_status IN ('unverified', 'valid', 'invalid'));

-- Employer-side number + consent (D10/D5 phase-5 prep) — collected later on a new
-- employer/settings page, columns land now so that page has somewhere to write.
ALTER TABLE public.employer_members ADD COLUMN IF NOT EXISTS whatsapp_number text;
ALTER TABLE public.employer_members ADD COLUMN IF NOT EXISTS whatsapp_opt_in boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- D11 consent ledger
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.whatsapp_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  opted_in boolean NOT NULL,
  source text NOT NULL, -- onboarding | settings | alert_form | nudge | stop_keyword | admin
  policy_version text NOT NULL DEFAULT 'v1',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_consents_user ON public.whatsapp_consents(user_id, at DESC);
GRANT SELECT ON public.whatsapp_consents TO authenticated;
GRANT ALL ON public.whatsapp_consents TO service_role;
ALTER TABLE public.whatsapp_consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wc owner or admin read" ON public.whatsapp_consents FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_platform_role(auth.uid(), 'super_admin'));
-- No direct INSERT policy for authenticated: all writes go through the
-- SECURITY DEFINER RPCs below so the row's source/user_id can't be spoofed.

-- Self-service: the authenticated candidate flips their own consent (onboarding,
-- settings, alert form, nudge card). Always derives user_id from auth.uid(),
-- never from a client-supplied value.
CREATE OR REPLACE FUNCTION public.record_whatsapp_consent(_opted_in boolean, _source text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  INSERT INTO public.whatsapp_consents(user_id, opted_in, source) VALUES (_uid, _opted_in, _source);
  UPDATE public.candidate_profiles SET whatsapp_opt_in = _opted_in WHERE user_id = _uid;
END $$;
REVOKE ALL ON FUNCTION public.record_whatsapp_consent(boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_whatsapp_consent(boolean, text) TO authenticated;

-- Service-role variant for flows with no auth.uid() in scope: the STOP-keyword
-- webhook handler and admin-initiated opt-outs (Phase 2/6).
CREATE OR REPLACE FUNCTION public.record_whatsapp_consent_for(_user uuid, _opted_in boolean, _source text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.whatsapp_consents(user_id, opted_in, source) VALUES (_user, _opted_in, _source);
  UPDATE public.candidate_profiles SET whatsapp_opt_in = _opted_in WHERE user_id = _user;
END $$;
REVOKE ALL ON FUNCTION public.record_whatsapp_consent_for(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_whatsapp_consent_for(uuid, boolean, text) TO service_role;

-- Backfill: one ledger row per existing candidate so the ledger has a head to
-- read even for profiles that pre-date this migration.
INSERT INTO public.whatsapp_consents(user_id, opted_in, source, at)
SELECT user_id, whatsapp_opt_in, 'backfill', now()
FROM public.candidate_profiles
WHERE whatsapp_number IS NOT NULL
ON CONFLICT DO NOTHING;

-- One-tap nudge (D3): flips both the master preference and legal consent in one
-- call for a candidate who already has a number but hasn't turned WhatsApp on.
CREATE OR REPLACE FUNCTION public.enable_whatsapp_alerts()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE public.candidate_profiles
  SET whatsapp_opt_in = true,
      notification_prefs = notification_prefs || '{"whatsapp_alerts": true}'::jsonb
  WHERE user_id = _uid;
  INSERT INTO public.whatsapp_consents(user_id, opted_in, source) VALUES (_uid, true, 'nudge');
END $$;
REVOKE ALL ON FUNCTION public.enable_whatsapp_alerts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enable_whatsapp_alerts() TO authenticated;

-- ---------------------------------------------------------------------------
-- D2 precedence helper — every send path calls this, never re-derives inline.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.should_send_whatsapp(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT p.whatsapp_number IS NOT NULL
       AND p.whatsapp_opt_in
       AND p.whatsapp_number_status <> 'invalid'
       AND COALESCE((p.notification_prefs->>'whatsapp_alerts')::boolean, false)
     FROM public.candidate_profiles p
     WHERE p.user_id = _user_id),
    false
  );
$$;
REVOKE ALL ON FUNCTION public.should_send_whatsapp(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.should_send_whatsapp(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- D6 caps: per-recipient daily hard cap, service-role variant
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.register_whatsapp_send_for(_user uuid, _count integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _today date := (now() at time zone 'utc')::date; _new integer;
BEGIN
  INSERT INTO public.whatsapp_send_ledger(user_id, day, count) VALUES (_user, _today, GREATEST(_count, 1))
    ON CONFLICT (user_id, day) DO UPDATE SET count = public.whatsapp_send_ledger.count + EXCLUDED.count
    RETURNING count INTO _new;
  IF _new > 50 THEN RAISE EXCEPTION 'Daily WhatsApp send limit (50) reached for user %', _user; END IF;
  RETURN _new;
END $$;
REVOKE ALL ON FUNCTION public.register_whatsapp_send_for(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_whatsapp_send_for(uuid, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- D6/D4/D7 tuning singleton
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.whatsapp_settings (
  id integer PRIMARY KEY DEFAULT 1,
  marketing_per_7d integer NOT NULL DEFAULT 2,
  marketing_min_gap_hours integer NOT NULL DEFAULT 48,
  quiet_start_hour int NOT NULL DEFAULT 21, -- IST
  quiet_end_hour int NOT NULL DEFAULT 8,
  dispatch_batch_size integer NOT NULL DEFAULT 200,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_settings_singleton CHECK (id = 1)
);
GRANT SELECT ON public.whatsapp_settings TO authenticated;
GRANT ALL ON public.whatsapp_settings TO service_role;
ALTER TABLE public.whatsapp_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws read authenticated" ON public.whatsapp_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "ws admin write" ON public.whatsapp_settings FOR UPDATE TO authenticated
  USING (public.has_platform_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_platform_role(auth.uid(), 'super_admin'));
INSERT INTO public.whatsapp_settings(id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TRIGGER trg_whatsapp_settings_updated BEFORE UPDATE ON public.whatsapp_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- D5 template catalog (Phase 2 schema, landed now so Phase 2 is wiring-only)
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE public.whatsapp_template_category AS ENUM ('utility', 'marketing', 'authentication');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.whatsapp_message_status AS ENUM
    ('queued', 'sent', 'delivered', 'read', 'failed', 'invalid_number');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  category public.whatsapp_template_category NOT NULL,
  provider_template_id text NOT NULL,
  language text NOT NULL DEFAULT 'en',
  variables jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'approved', -- approved | paused
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.whatsapp_templates TO authenticated;
GRANT ALL ON public.whatsapp_templates TO service_role;
ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wt read authenticated" ON public.whatsapp_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "wt admin write" ON public.whatsapp_templates FOR ALL TO authenticated
  USING (public.has_platform_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_platform_role(auth.uid(), 'super_admin'));

CREATE TRIGGER trg_whatsapp_templates_updated BEFORE UPDATE ON public.whatsapp_templates
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- D9 event -> template map (v1). provider_template_id is a placeholder (the key
-- itself) until ops maps it to the real Meta-approved template name.
INSERT INTO public.whatsapp_templates (key, category, provider_template_id, variables) VALUES
  ('application_status_update', 'utility', 'application_status_update', '["candidate_name","job_title","status"]'),
  ('interview_scheduled', 'utility', 'interview_scheduled', '["candidate_name","job_title","interview_time"]'),
  ('interview_reminder', 'utility', 'interview_reminder', '["candidate_name","job_title","interview_time"]'),
  ('job_alert_instant', 'utility', 'job_alert_instant', '["candidate_name","job_title","company_name","city"]'),
  ('job_alert_digest', 'utility', 'job_alert_digest', '["candidate_name","job_count"]'),
  ('invite_to_apply', 'utility', 'invite_to_apply', '["candidate_name","job_title","company_name"]'),
  ('job_expiry_reminder', 'utility', 'job_expiry_reminder', '["employer_name","job_title","days_left"]'),
  ('recommended_jobs_weekly', 'marketing', 'recommended_jobs_weekly', '["candidate_name","job_count"]'),
  ('reengagement_nudge', 'marketing', 'reengagement_nudge', '["candidate_name"]')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- D4/D7 outbox + log (Phase 2 schema)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recipient_number text NOT NULL,
  direction text NOT NULL DEFAULT 'outbound',
  template_key text REFERENCES public.whatsapp_templates(key),
  category public.whatsapp_template_category,
  variables jsonb,
  source text NOT NULL, -- alert_instant | alert_digest | application_status | interview_scheduled
                         -- | interview_reminder | invite_to_apply | employer_outreach
                         -- | job_expiry_reminder | marketing_nudge
  reference jsonb, -- {job_id, application_id, alert_id, interview_id, company_id}
  provider text NOT NULL DEFAULT 'meta_cloud',
  provider_message_id text,
  status public.whatsapp_message_status NOT NULL DEFAULT 'queued',
  status_detail text,
  attempts int NOT NULL DEFAULT 0,
  queued_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_provider_msg ON public.whatsapp_messages(provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wa_dispatch ON public.whatsapp_messages(status, queued_at)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_wa_recipient ON public.whatsapp_messages(recipient_user, sent_at DESC);
-- Phase-3 dedup: one message per (alert/application/interview reference + template).
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_reference_template
  ON public.whatsapp_messages((reference->>'alert_id'), (reference->>'job_id'), template_key)
  WHERE source IN ('alert_instant', 'alert_digest') AND reference ? 'alert_id';

GRANT SELECT ON public.whatsapp_messages TO authenticated;
GRANT ALL ON public.whatsapp_messages TO service_role;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wm owner read" ON public.whatsapp_messages FOR SELECT TO authenticated
  USING (recipient_user = auth.uid() OR public.has_platform_role(auth.uid(), 'super_admin'));
CREATE POLICY "wm employer reads own outreach" ON public.whatsapp_messages FOR SELECT TO authenticated
  USING (
    source = 'employer_outreach'
    AND reference ? 'company_id'
    AND public.has_company_membership(auth.uid(), (reference->>'company_id')::uuid)
  );
-- No client INSERT/UPDATE policy: the outbox is only ever written by
-- service-role edge functions (Phase 2/3) or the employer-outreach RPC (Phase 5).

-- ---------------------------------------------------------------------------
-- D6/D10 employer per-post outreach cap (schema lands now; called starting Phase 5)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_company_on_free_plan(_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.company_plans cp
    JOIN public.plans p ON p.id = cp.plan_id
    WHERE cp.company_id = _company_id
      AND cp.status = 'active'
      AND (cp.ends_at IS NULL OR cp.ends_at > now())
      AND p.price_inr > 0
  );
$$;

CREATE OR REPLACE FUNCTION public.assert_whatsapp_post_cap(_job_id uuid, _candidate_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _company_id uuid;
  _cap integer;
  _used integer;
  _rajasthan_only boolean;
  _candidate_city text;
  _candidate_state text;
BEGIN
  SELECT company_id INTO _company_id FROM public.jobs WHERE id = _job_id;
  IF _company_id IS NULL THEN RAISE EXCEPTION 'Unknown job %', _job_id; END IF;

  SELECT free_whatsapp_cap_per_post, free_whatsapp_rajasthan_only
    INTO _cap, _rajasthan_only
  FROM public.plan_settings WHERE id = 1;

  IF public.is_company_on_free_plan(_company_id) THEN
    SELECT count(*) INTO _used FROM public.whatsapp_messages
      WHERE source = 'employer_outreach' AND reference->>'job_id' = _job_id::text;
    IF _used >= _cap THEN
      RAISE EXCEPTION 'Employer WhatsApp outreach cap (%) reached for job %', _cap, _job_id;
    END IF;

    IF _rajasthan_only THEN
      SELECT pr.city INTO _candidate_city FROM public.profiles pr WHERE pr.id = _candidate_user_id;
      SELECT c.state INTO _candidate_state FROM public.cities c WHERE lower(c.name) = lower(_candidate_city) LIMIT 1;
      IF _candidate_state IS DISTINCT FROM 'Rajasthan' THEN
        RAISE EXCEPTION 'Free-plan WhatsApp outreach is restricted to Rajasthan candidates';
      END IF;
    END IF;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.assert_whatsapp_post_cap(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_whatsapp_post_cap(uuid, uuid) TO authenticated, service_role;
