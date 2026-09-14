-- Dedup tracking for alert-matching emails: one row per (alert, job) pair
-- that has already been emailed, so instant/digest sends never double-notify
-- (also guards against Database Webhook retries firing the instant function
-- more than once for the same job).
CREATE TABLE IF NOT EXISTS public.alert_job_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid NOT NULL REFERENCES public.candidate_job_alerts(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  notified_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (alert_id, job_id)
);
GRANT ALL ON public.alert_job_notifications TO service_role;
ALTER TABLE public.alert_job_notifications ENABLE ROW LEVEL SECURITY;
-- Internal bookkeeping only — no UI reads this table, so no policies for
-- authenticated/anon are added. Edge Functions use the service-role client,
-- which bypasses RLS entirely.

CREATE INDEX IF NOT EXISTS idx_alert_job_notifications_alert ON public.alert_job_notifications(alert_id);

-- Scheduling for the daily/weekly digest functions.
-- NOTE: pg_cron requires a long-running background worker and is only
-- available on Supabase's Pro plan and above — if this project is on the
-- Free plan, this extension will fail to enable and the digest schedules
-- below won't run. See the final report for how to check/upgrade.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- cron.schedule() upserts by job name (replaces an existing job with the
-- same name rather than erroring), so this migration stays re-runnable
-- without needing an explicit unschedule-first step.

-- Daily digest: 09:00 UTC (~14:30 IST) every day.
SELECT cron.schedule(
  'alert-digest-daily',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url := 'https://swdntxurukbkyksuyzhg.functions.supabase.co/alert-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := jsonb_build_object('frequency', 'daily')
  );
  $$
);

-- Weekly digest: 09:00 UTC every Monday.
SELECT cron.schedule(
  'alert-digest-weekly',
  '0 9 * * 1',
  $$
  SELECT net.http_post(
    url := 'https://swdntxurukbkyksuyzhg.functions.supabase.co/alert-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := jsonb_build_object('frequency', 'weekly')
  );
  $$
);
