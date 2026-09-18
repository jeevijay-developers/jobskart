-- Slice 5 of the in-app video interview feature: pg_cron schedule for the
-- T-30 reminder email. Mirrors the alert-digest wiring in
-- 20260914075503_alert_job_notifications.sql exactly (pg_cron/pg_net are
-- already enabled by that migration) — every minute, POST to the
-- interview-reminder Edge Function, which atomically claims any interview
-- starting within the next 30 minutes that hasn't been reminded yet.
--
-- cron.schedule() upserts by job name, so this migration stays re-runnable.
SELECT cron.schedule(
  'interview-t30-reminder',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://swdntxurukbkyksuyzhg.functions.supabase.co/interview-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
