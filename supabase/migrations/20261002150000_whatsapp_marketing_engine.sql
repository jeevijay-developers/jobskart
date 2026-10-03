-- WhatsApp-centric UX, Phase 4: marketing engine (D4/D6/D7/D9 marketing rows)
-- + the dispatch sweeper's cron wiring. See
-- whatsapp-centric-ux-implementation-improved.md for the full design.
--
-- The two nudge functions below only enqueue `queued` whatsapp_messages rows
-- (category='marketing') — they never call the provider directly. The
-- whatsapp-dispatch edge function (cron below) drains the queue, enforcing
-- quiet hours and the per-recipient frequency cap at send time, per D7.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- D9 "Recommended-jobs nudge": candidates with >=3 jobs posted in the last 7
-- days matching their preferred city or skills. Deliberately a simple
-- keyword/city match here, not a call into recommend_jobs_for_candidate() —
-- that RPC derives its candidate from auth.uid() (it's meant for the
-- authenticated candidate's own live search), is under active iteration, and
-- isn't shaped for a service-role batch job scanning every candidate. This
-- keeps the marketing cron decoupled from that engine's internals.
CREATE OR REPLACE FUNCTION public.enqueue_recommended_jobs_nudges()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _count integer;
BEGIN
  WITH candidates AS (
    SELECT p.user_id, p.whatsapp_number, pr.full_name,
      (SELECT count(*) FROM public.jobs j
       WHERE j.status = 'active'
         AND j.created_at > now() - interval '7 days'
         AND (
           j.city = ANY(p.preferred_cities)
           OR EXISTS (
             SELECT 1 FROM unnest(p.skills) s
             WHERE s <> '' AND j.title ILIKE '%' || s || '%'
           )
         )
      ) AS match_count
    FROM public.candidate_profiles p
    JOIN public.profiles pr ON pr.id = p.user_id
    WHERE p.whatsapp_number IS NOT NULL
      AND public.should_send_whatsapp(p.user_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.whatsapp_messages m
        WHERE m.recipient_user = p.user_id
          AND m.template_key = 'recommended_jobs_weekly'
          AND m.queued_at > now() - interval '7 days'
      )
  ), eligible AS (
    SELECT * FROM candidates WHERE match_count >= 3
  )
  INSERT INTO public.whatsapp_messages
    (recipient_user, recipient_number, template_key, category, variables, source, reference, status)
  SELECT user_id, whatsapp_number, 'recommended_jobs_weekly', 'marketing',
    jsonb_build_array(COALESCE(full_name, 'there'), match_count),
    'marketing_nudge', '{}'::jsonb, 'queued'
  FROM eligible;
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_recommended_jobs_nudges() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_recommended_jobs_nudges() TO service_role;

-- D9 "Re-engagement nudge": candidates inactive 14+ days (auth.users.last_sign_in_at,
-- the same last-active proxy compute_candidate_match() already uses — see
-- 20260924052105's documented simplification — since candidate_profiles has
-- no last_active_at column), at most once per 30 days.
CREATE OR REPLACE FUNCTION public.enqueue_reengagement_nudges()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _count integer;
BEGIN
  INSERT INTO public.whatsapp_messages
    (recipient_user, recipient_number, template_key, category, variables, source, reference, status)
  SELECT p.user_id, p.whatsapp_number, 'reengagement_nudge', 'marketing',
    jsonb_build_array(COALESCE(pr.full_name, 'there')),
    'marketing_nudge', '{}'::jsonb, 'queued'
  FROM public.candidate_profiles p
  JOIN public.profiles pr ON pr.id = p.user_id
  JOIN auth.users u ON u.id = p.user_id
  WHERE p.whatsapp_number IS NOT NULL
    AND public.should_send_whatsapp(p.user_id)
    AND u.last_sign_in_at < now() - interval '14 days'
    AND NOT EXISTS (
      SELECT 1 FROM public.whatsapp_messages m
      WHERE m.recipient_user = p.user_id
        AND m.template_key = 'reengagement_nudge'
        AND m.queued_at > now() - interval '30 days'
    );
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_reengagement_nudges() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_reengagement_nudges() TO service_role;

-- Weekly recommended-jobs nudge: Monday 10:00 UTC (~15:30 IST).
SELECT cron.schedule(
  'whatsapp-recommended-jobs-nudge',
  '0 10 * * 1',
  $$ SELECT public.enqueue_recommended_jobs_nudges(); $$
);

-- Re-engagement sweep runs daily; the 30-day NOT EXISTS guard above is what
-- actually enforces the "at most once per 30 days" cap, not the schedule.
SELECT cron.schedule(
  'whatsapp-reengagement-nudge',
  '0 11 * * *',
  $$ SELECT public.enqueue_reengagement_nudges(); $$
);

-- Dispatch sweeper: drains `queued` whatsapp_messages every 10 minutes.
SELECT cron.schedule(
  'whatsapp-dispatch-sweeper',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://swdntxurukbkyksuyzhg.functions.supabase.co/whatsapp-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
