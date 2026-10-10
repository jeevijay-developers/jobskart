-- Job alerts v2: activation event, tier reach budget, idempotency, daily caps.
-- LOCAL DB only. Needs supabase/tests/fixtures/seed_local.sql. Rolls back.
BEGIN;

DO $$
DECLARE
  _job uuid; _title text; _kw text; _n int; _instant int; _digest int; _ok boolean;
  _u uuid[];
BEGIN
  SELECT id, title INTO _job, _title FROM public.jobs
   WHERE id::text LIKE '00000000-0000-4000-8000-00000000b0%' LIMIT 1;
  ASSERT _job IS NOT NULL, 'fixture job missing';
  _kw := lower(split_part(_title, ' ', 1));

  SELECT array_agg(user_id) INTO _u FROM (
    SELECT user_id FROM public.candidate_profiles
     WHERE user_id::text LIKE '00000000-0000-4000-8000-00000000c0%' LIMIT 5) s;
  ASSERT array_length(_u, 1) = 5, 'need 5 fixture candidates';

  DELETE FROM public.candidate_job_alerts WHERE user_id = ANY(_u);
  INSERT INTO public.candidate_job_alerts(user_id, name, query, frequency, email_enabled, whatsapp_enabled)
  SELECT u, _kw, jsonb_build_object('keyword', _kw), 'instant', true, true FROM unnest(_u) u;
  DELETE FROM public.alert_job_notifications WHERE job_id = _job;
  DELETE FROM public.alert_deliveries WHERE job_id = _job;
  DELETE FROM public.job_alert_events WHERE job_id = _job;

  UPDATE public.plan_settings SET alert_reach = '{"classic":2,"classic_plus":2,"trending":2}' WHERE id = 1;

  -- Activation transition fires the event (draft -> active).
  UPDATE public.jobs SET status = 'draft' WHERE id = _job;
  ASSERT NOT EXISTS (SELECT 1 FROM public.job_alert_events WHERE job_id = _job), 'no event while draft';
  UPDATE public.jobs SET status = 'active' WHERE id = _job;
  ASSERT EXISTS (SELECT 1 FROM public.job_alert_events WHERE job_id = _job), 'event on activation';

  -- Reach budget: 2 instant, rest digest.
  _n := public.plan_alert_deliveries(_job);
  ASSERT _n = 5, format('expected 5 deliveries, got %s', _n);
  SELECT count(*) FILTER (WHERE mode='instant'), count(*) FILTER (WHERE mode='digest')
    INTO _instant, _digest FROM public.alert_deliveries WHERE job_id = _job;
  ASSERT _instant = 2 AND _digest = 3, format('reach split wrong: %s/%s', _instant, _digest);

  -- Idempotent.
  ASSERT public.plan_alert_deliveries(_job) = 0, 'second plan must add nothing';

  -- Daily per-candidate caps.
  UPDATE public.whatsapp_settings SET alert_wa_per_day = 2;
  DELETE FROM public.alert_send_ledger WHERE user_id = _u[1];
  ASSERT public.claim_alert_slot(_u[1], 'whatsapp'), 'slot 1';
  ASSERT public.claim_alert_slot(_u[1], 'whatsapp'), 'slot 2';
  _ok := public.claim_alert_slot(_u[1], 'whatsapp');
  ASSERT NOT _ok, 'third slot must be refused';
END $$;

-- boost_alert_reach(): credit top-up raises the reach budget and is reflected
-- by a fresh plan_alert_deliveries() run; shortfall maps to 'no_credits'.
DO $$
DECLARE
  _job uuid; _company uuid; _member uuid; _before int; _after int; _raised boolean := false;
BEGIN
  SELECT id, company_id INTO _job, _company FROM public.jobs
   WHERE id::text LIKE '00000000-0000-4000-8000-00000000b0%' LIMIT 1;
  SELECT user_id INTO _member FROM public.employer_members WHERE company_id = _company LIMIT 1;
  ASSERT _member IS NOT NULL, 'fixture employer member missing';

  DELETE FROM public.job_alert_reach_topups WHERE job_id = _job;
  INSERT INTO public.employer_credit_wallets (company_id, job_post_balance) VALUES (_company, 1000)
    ON CONFLICT (company_id) DO UPDATE SET job_post_balance = 1000;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _member::text, 'role', 'authenticated')::text, true);
  PERFORM public.boost_alert_reach(_job, 1);
  SELECT extra_reach INTO _after FROM public.job_alert_reach_topups WHERE job_id = _job;
  ASSERT _after = 50, format('expected 50 extra reach, got %s', _after);

  UPDATE public.employer_credit_wallets SET job_post_balance = 0 WHERE company_id = _company;
  BEGIN
    PERFORM public.boost_alert_reach(_job, 1);
  EXCEPTION WHEN OTHERS THEN
    _raised := (SQLERRM = 'no_credits');
  END;
  ASSERT _raised, 'shortfall must raise no_credits';
  PERFORM set_config('request.jwt.claims', '', true);
END $$;

ROLLBACK;
