-- Job alerts v2 foundation: DB-side activation events, tier-based reach budget,
-- per-candidate daily caps, and a delivery outbox. Nothing here sends messages;
-- edge functions drain alert_deliveries behind the alert_v2_enabled flag.

-- 1) Settings --------------------------------------------------------------
ALTER TABLE public.plan_settings
  ADD COLUMN IF NOT EXISTS alert_reach jsonb NOT NULL
    DEFAULT '{"classic":50,"classic_plus":150,"trending":500}'::jsonb;

ALTER TABLE public.whatsapp_settings
  ADD COLUMN IF NOT EXISTS alert_wa_per_day integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS alert_email_per_day integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS alert_digest_max_jobs integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS alert_v2_enabled boolean NOT NULL DEFAULT false;

-- 2) Activation events (replaces the dashboard INSERT-only webhook) ---------
CREATE TABLE IF NOT EXISTS public.job_alert_events (
  job_id uuid PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
  activated_at timestamptz NOT NULL DEFAULT now(),
  planned_at timestamptz
);
ALTER TABLE public.job_alert_events ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.job_alert_events TO service_role;
CREATE INDEX IF NOT EXISTS idx_job_alert_events_pending
  ON public.job_alert_events(activated_at) WHERE planned_at IS NULL;

CREATE OR REPLACE FUNCTION public.tg_jobs_alert_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'active'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active') THEN
    INSERT INTO public.job_alert_events(job_id) VALUES (NEW.id)
    ON CONFLICT (job_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_jobs_alert_event ON public.jobs;
CREATE TRIGGER tg_jobs_alert_event
  AFTER INSERT OR UPDATE OF status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_jobs_alert_event();

-- 3) Delivery outbox --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.alert_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid NOT NULL REFERENCES public.candidate_job_alerts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('instant','digest')),
  score integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','skipped','failed')),
  attempts integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (alert_id, job_id)
);
ALTER TABLE public.alert_deliveries ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.alert_deliveries TO service_role;
CREATE INDEX IF NOT EXISTS idx_alert_deliveries_pending
  ON public.alert_deliveries(mode, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_alert_deliveries_job ON public.alert_deliveries(job_id);

-- 4) Per-candidate daily caps ----------------------------------------------
CREATE TABLE IF NOT EXISTS public.alert_send_ledger (
  user_id uuid NOT NULL,
  day date NOT NULL,
  channel text NOT NULL CHECK (channel IN ('whatsapp','email')),
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, channel)
);
ALTER TABLE public.alert_send_ledger ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.alert_send_ledger TO service_role;

-- Atomically takes one slot; returns false when the daily cap is reached.
CREATE OR REPLACE FUNCTION public.claim_alert_slot(_user uuid, _channel text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _cap int;
  _day date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  _n int;
BEGIN
  IF _channel NOT IN ('whatsapp','email') THEN
    RAISE EXCEPTION 'invalid_channel';
  END IF;
  SELECT CASE _channel WHEN 'whatsapp' THEN alert_wa_per_day ELSE alert_email_per_day END
    INTO _cap FROM public.whatsapp_settings LIMIT 1;
  _cap := COALESCE(_cap, CASE _channel WHEN 'whatsapp' THEN 3 ELSE 1 END);

  INSERT INTO public.alert_send_ledger(user_id, day, channel, count)
  VALUES (_user, _day, _channel, 0)
  ON CONFLICT DO NOTHING;

  UPDATE public.alert_send_ledger SET count = count + 1
   WHERE user_id = _user AND day = _day AND channel = _channel AND count < _cap
  RETURNING count INTO _n;

  RETURN _n IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.claim_alert_slot(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_alert_slot(uuid, text) TO service_role;

-- 5) Match + plan -----------------------------------------------------------
-- Scores matching alerts for a job, marks the top-N (N = tier reach budget) of
-- frequency='instant' alerts as 'instant' and everything else as 'digest', and
-- enqueues one pending delivery per alert. Idempotent on (alert_id, job_id).
-- Ranking weights stay server-side.
CREATE OR REPLACE FUNCTION public.plan_alert_deliveries(_job_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _job record;
  _reach int;
  _n int;
BEGIN
  SELECT j.id, j.title, j.city, j.tier::text AS tier, j.status
    INTO _job FROM public.jobs j WHERE j.id = _job_id FOR SHARE;
  IF NOT FOUND OR _job.status <> 'active' THEN RETURN 0; END IF;

  SELECT COALESCE((ps.alert_reach ->> _job.tier)::int, 50)
    INTO _reach FROM public.plan_settings ps WHERE ps.id = 1;
  _reach := COALESCE(_reach, 50);

  WITH matches AS (
    SELECT a.id AS alert_id, a.user_id, a.frequency,
           (CASE WHEN COALESCE(a.query->>'keyword','') <> '' THEN
                  CASE WHEN lower(_job.title) ~ ('\m' || regexp_replace(lower(a.query->>'keyword'), '([^a-z0-9 ])', '\\\1', 'g') || '\M')
                       THEN 70 ELSE 50 END
                 ELSE 0 END
            + CASE WHEN COALESCE(a.query->>'city','') <> '' THEN 30 ELSE 0 END) AS score
      FROM public.candidate_job_alerts a
     WHERE a.is_active
       AND (a.email_enabled OR a.whatsapp_enabled)
       AND (COALESCE(a.query->>'keyword','') = ''
            OR lower(_job.title) LIKE '%' || lower(trim(a.query->>'keyword')) || '%')
       AND (COALESCE(a.query->>'city','') = ''
            OR lower(COALESCE(_job.city,'')) LIKE '%' || lower(trim(a.query->>'city')) || '%')
       AND NOT EXISTS (SELECT 1 FROM public.alert_job_notifications n
                        WHERE n.alert_id = a.id AND n.job_id = _job_id)
  ), ranked AS (
    SELECT m.*, row_number() OVER (
             PARTITION BY (m.frequency = 'instant')
             ORDER BY m.score DESC, m.alert_id) AS rn
      FROM matches m
  )
  INSERT INTO public.alert_deliveries(alert_id, user_id, job_id, mode, score)
  SELECT r.alert_id, r.user_id, _job_id,
         CASE WHEN r.frequency = 'instant' AND r.rn <= _reach THEN 'instant' ELSE 'digest' END,
         r.score
    FROM ranked r
  ON CONFLICT (alert_id, job_id) DO NOTHING;

  GET DIAGNOSTICS _n = ROW_COUNT;
  UPDATE public.job_alert_events SET planned_at = now() WHERE job_id = _job_id;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.plan_alert_deliveries(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan_alert_deliveries(uuid) TO service_role;

CREATE INDEX IF NOT EXISTS idx_candidate_job_alerts_active_freq
  ON public.candidate_job_alerts(frequency) WHERE is_active;
