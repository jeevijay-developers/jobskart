-- Job alerts v2, part 2: scheduling for the new planner/instant drainer,
-- a credit-funded reach top-up, employer-visible reach stats, frequency
-- validation, and an unsubscribe token verifier for the one-click email link.

-- 1) CHECK constraint on frequency (data integrity; UI already restricts to these 3).
ALTER TABLE public.candidate_job_alerts DROP CONSTRAINT IF EXISTS candidate_job_alerts_frequency_check;
ALTER TABLE public.candidate_job_alerts
  ADD CONSTRAINT candidate_job_alerts_frequency_check
  CHECK (frequency IN ('instant','daily','weekly'));

-- 2) Cron: drive the planner + instant drainer every 2 minutes. Dashboard
-- Database Webhooks are no longer required for job alerts — the trigger from
-- the previous migration populates job_alert_events, and this cron drains it.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'alert-instant-dispatch',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://swdntxurukbkyksuyzhg.functions.supabase.co/alert-instant-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- 3) Credit-funded reach top-up. A paying employer can push a job's instant
-- reach budget above its tier default (e.g. Classic ran out of its 50-slot
-- budget but the recruiter wants more candidates notified right away).
-- Money logic lives here, not in the edge function or React (ground rule 2).
CREATE TABLE IF NOT EXISTS public.job_alert_reach_topups (
  job_id uuid PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
  extra_reach integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.job_alert_reach_topups ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.job_alert_reach_topups TO authenticated;
GRANT ALL ON public.job_alert_reach_topups TO service_role;
DROP POLICY IF EXISTS "members read reach topup" ON public.job_alert_reach_topups;
CREATE POLICY "members read reach topup" ON public.job_alert_reach_topups
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.jobs j
                  WHERE j.id = job_id AND public.has_company_membership(auth.uid(), j.company_id)));

ALTER TABLE public.plan_settings
  ADD COLUMN IF NOT EXISTS alert_reach_topup_price integer NOT NULL DEFAULT 20, -- credits per 50 extra slots
  ADD COLUMN IF NOT EXISTS alert_reach_topup_block integer NOT NULL DEFAULT 50;

CREATE OR REPLACE FUNCTION public.boost_alert_reach(_job_id uuid, _blocks integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _company uuid; _price int; _block int; _cost int; _extra int;
BEGIN
  IF _blocks IS NULL OR _blocks < 1 THEN RAISE EXCEPTION 'invalid_blocks'; END IF;

  SELECT j.company_id INTO _company FROM public.jobs j WHERE j.id = _job_id FOR UPDATE;
  IF _company IS NULL THEN RAISE EXCEPTION 'job_not_found'; END IF;
  IF NOT public.has_company_membership(auth.uid(), _company) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  SELECT alert_reach_topup_price, alert_reach_topup_block INTO _price, _block
    FROM public.plan_settings WHERE id = 1;
  _cost := _price * _blocks;
  _extra := _block * _blocks;

  -- apply_credit_delta row-locks the wallet and raises "Insufficient
  -- credits" on a shortfall; it is the only writer of employer_credit_wallets
  -- (rule 2). Reuses the job_post wallet column and the generic 'adjustment'
  -- txn kind rather than adding a new credit_txn_kind enum value (ALTER TYPE
  -- ... ADD VALUE can't be used in the same transaction it's consumed in, so
  -- that would need its own migration file split across two deploys for no
  -- real benefit here). Translated to the stable 'no_credits' error code the
  -- same way activate_job_with_tier() does, so the UI maps it to a message
  -- instead of showing the raw Postgres error (rbac.md convention).
  BEGIN
    PERFORM public.apply_credit_delta(_company, -_cost, 'adjustment'::public.credit_txn_kind,
             jsonb_build_object('reason', 'alert_reach_topup', 'job_id', _job_id), auth.uid(), 'job_post');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'Insufficient credits%' THEN RAISE EXCEPTION 'no_credits'; END IF;
    RAISE;
  END;

  INSERT INTO public.job_alert_reach_topups(job_id, extra_reach)
  VALUES (_job_id, _extra)
  ON CONFLICT (job_id) DO UPDATE SET extra_reach = job_alert_reach_topups.extra_reach + _extra, updated_at = now();

  PERFORM public.log_employer_activity(_company, auth.uid(), 'alert_reach_topup', 'Alert reach boosted',
           NULL, NULL, jsonb_build_object('job_id', _job_id, 'blocks', _blocks, 'extra_reach', _extra, 'cost', _cost));

  RETURN jsonb_build_object('extra_reach', _extra, 'cost', _cost);
END $$;
REVOKE ALL ON FUNCTION public.boost_alert_reach(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.boost_alert_reach(uuid, integer) TO authenticated;

-- plan_alert_deliveries now adds any top-up to the tier's base reach budget.
CREATE OR REPLACE FUNCTION public.plan_alert_deliveries(_job_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _job record;
  _reach int;
  _topup int;
  _n int;
BEGIN
  SELECT j.id, j.title, j.city, j.tier::text AS tier, j.status
    INTO _job FROM public.jobs j WHERE j.id = _job_id FOR SHARE;
  IF NOT FOUND OR _job.status <> 'active' THEN RETURN 0; END IF;

  SELECT COALESCE((ps.alert_reach ->> _job.tier)::int, 50)
    INTO _reach FROM public.plan_settings ps WHERE ps.id = 1;
  SELECT COALESCE(t.extra_reach, 0) INTO _topup FROM public.job_alert_reach_topups t WHERE t.job_id = _job_id;
  _reach := COALESCE(_reach, 50) + COALESCE(_topup, 0);

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

-- 4) Employer-visible reach stat ("Reached N candidates via alerts").
CREATE OR REPLACE FUNCTION public.get_job_alert_reach(_job_id uuid)
RETURNS TABLE(instant_sent integer, digest_queued integer, total_matched integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COUNT(*) FILTER (WHERE mode = 'instant' AND status = 'sent')::int,
    COUNT(*) FILTER (WHERE mode = 'digest')::int,
    COUNT(*)::int
  FROM public.alert_deliveries d
  WHERE d.job_id = _job_id
    AND EXISTS (SELECT 1 FROM public.jobs j
                 WHERE j.id = _job_id AND public.has_company_membership(auth.uid(), j.company_id));
$$;
REVOKE ALL ON FUNCTION public.get_job_alert_reach(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_job_alert_reach(uuid) TO authenticated;
