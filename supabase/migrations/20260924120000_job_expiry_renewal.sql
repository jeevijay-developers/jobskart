-- Job Expiry & Auto-Renewal System (see job-expiry-auto-renewal-implementation.md):
--   Default Validity (30d, already the jobs.expires_at default), Expiry Action
--   (status -> 'expired', hidden from search), Renewal (manual + auto),
--   Auto-Renew Condition (plan entitlement), Notification (pre-expiry reminders).
--
-- Deviations/notes vs the plan doc:
--   - companies.plan_id is added nullable; NULL means "platform default" from
--     plan_settings, so entitlements work before any company is on a paid plan.
--   - process_job_expiry_batch / claim_due_expiry_reminders are EXECUTE-able
--     by service_role only (Edge Functions via pg_cron), never by anon or
--     authenticated clients.
--   - feed_jobs() is recreated here with an expires_at read-time guard so a
--     stale sweeper can never keep an expired job visible (defense in depth;
--     the sweeper remains the thing that flips status).

-- 1) jobs columns
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS auto_renew boolean NOT NULL DEFAULT false;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS renewed_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS last_renewed_at timestamptz;

-- 2) company <-> plan link (foundation for per-plan entitlements; no billing yet)
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES public.plans(id);

-- 3) plan_settings knobs
ALTER TABLE public.plan_settings ADD COLUMN IF NOT EXISTS auto_renew_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.plan_settings ADD COLUMN IF NOT EXISTS auto_renew_max_times integer NOT NULL DEFAULT 3;
ALTER TABLE public.plan_settings ADD COLUMN IF NOT EXISTS expiry_reminder_days integer[] NOT NULL DEFAULT '{7,3,1}';

-- 4) Entitlement resolver: plan limits override the platform default.
CREATE OR REPLACE FUNCTION public.company_auto_renew(_company_id uuid)
RETURNS TABLE(enabled boolean, max_times int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE((p.limits ->> 'auto_renew')::boolean, ps.auto_renew_enabled),
    COALESCE((p.limits ->> 'auto_renew_max')::int, ps.auto_renew_max_times)
  FROM public.plan_settings ps
  LEFT JOIN public.companies c ON c.id = _company_id
  LEFT JOIN public.plans p ON p.id = c.plan_id
  WHERE ps.id = 1;
$$;
REVOKE ALL ON FUNCTION public.company_auto_renew(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.company_auto_renew(uuid) TO authenticated, service_role;

-- 5) renew_job() — manual renewal. Stacks from the later of now()/old expiry
--    so renewing early never loses days; flips expired jobs back to active.
--    The existing tg_jobs_lock_window_upd trigger extends
--    responses_locked_after automatically when expires_at moves.
CREATE OR REPLACE FUNCTION public.renew_job(_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _company uuid;
  _status public.job_status;
  _expires timestamptz;
  _title text;
  _days int;
  _new timestamptz;
BEGIN
  SELECT company_id, status, expires_at, title
    INTO _company, _status, _expires, _title
  FROM public.jobs WHERE id = _job_id FOR UPDATE;

  IF _company IS NULL THEN RAISE EXCEPTION 'job_not_found'; END IF;
  IF NOT public.has_company_role(auth.uid(), _company, ARRAY['super_admin','hr_admin','recruiter']) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  IF _status NOT IN ('active','expired') THEN RAISE EXCEPTION 'job_not_renewable'; END IF;

  SELECT COALESCE(free_validity_days, 30) INTO _days FROM public.plan_settings WHERE id = 1;
  _new := GREATEST(now(), COALESCE(_expires, now())) + (_days || ' days')::interval;

  UPDATE public.jobs
    SET expires_at = _new, status = 'active', renewed_count = 0, last_renewed_at = now()
    WHERE id = _job_id;

  PERFORM public.log_employer_activity(
    _company, auth.uid(), 'job.renewed', 'Job renewed', _title, '/employer/jobs',
    jsonb_build_object('job_id', _job_id, 'expires_at', _new)
  );
  RETURN jsonb_build_object('expires_at', _new);
END $$;
REVOKE ALL ON FUNCTION public.renew_job(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renew_job(uuid) TO authenticated;

-- 6) set_job_auto_renew() — entitlement-gated toggle.
CREATE OR REPLACE FUNCTION public.set_job_auto_renew(_job_id uuid, _enabled boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _company uuid;
  _status public.job_status;
  _title text;
  _renewed int;
  _ent RECORD;
BEGIN
  SELECT company_id, status, title, renewed_count
    INTO _company, _status, _title, _renewed
  FROM public.jobs WHERE id = _job_id FOR UPDATE;

  IF _company IS NULL THEN RAISE EXCEPTION 'job_not_found'; END IF;
  IF NOT public.has_company_role(auth.uid(), _company, ARRAY['super_admin','hr_admin','recruiter']) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  IF _status <> 'active' THEN RAISE EXCEPTION 'job_not_active'; END IF;

  IF _enabled THEN
    SELECT * INTO _ent FROM public.company_auto_renew(_company);
    IF NOT _ent.enabled THEN RAISE EXCEPTION 'auto_renew_not_in_plan'; END IF;
    IF _renewed >= _ent.max_times THEN RAISE EXCEPTION 'auto_renew_limit_reached'; END IF;
  END IF;

  UPDATE public.jobs SET auto_renew = _enabled WHERE id = _job_id;

  PERFORM public.log_employer_activity(
    _company, auth.uid(), 'job.auto_renew_toggled',
    CASE WHEN _enabled THEN 'Auto-renew enabled' ELSE 'Auto-renew disabled' END,
    _title, '/employer/jobs', jsonb_build_object('job_id', _job_id, 'enabled', _enabled)
  );
END $$;
REVOKE ALL ON FUNCTION public.set_job_auto_renew(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_job_auto_renew(uuid, boolean) TO authenticated;

-- 7) process_job_expiry_batch() — the single place expiry state changes.
--    Idempotent: both passes filter on status='active' AND expires_at <= now(),
--    so cron retries or double-fires are no-ops. Service-role only.
CREATE OR REPLACE FUNCTION public.process_job_expiry_batch()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _days int;
  _r RECORD;
  _renewed jsonb := '[]'::jsonb;
  _expired jsonb := '[]'::jsonb;
BEGIN
  SELECT COALESCE(free_validity_days, 30) INTO _days FROM public.plan_settings WHERE id = 1;

  -- Pass 1: auto-renew entitled jobs before they expire.
  FOR _r IN
    UPDATE public.jobs j
      SET expires_at = j.expires_at + (_days || ' days')::interval,
          renewed_count = j.renewed_count + 1,
          last_renewed_at = now()
      WHERE j.id IN (
        SELECT j2.id FROM public.jobs j2
        WHERE j2.status = 'active'
          AND j2.expires_at <= now()
          AND j2.auto_renew
          AND (SELECT ca.enabled FROM public.company_auto_renew(j2.company_id) ca)
          AND j2.renewed_count < (SELECT ca.max_times FROM public.company_auto_renew(j2.company_id) ca)
        FOR UPDATE OF j2
      )
      RETURNING j.id, j.company_id, j.title, j.expires_at
  LOOP
    _renewed := _renewed || jsonb_build_object(
      'job_id', _r.id, 'company_id', _r.company_id, 'title', _r.title, 'expires_at', _r.expires_at);
    PERFORM public.log_employer_activity(
      _r.company_id, NULL, 'job.auto_renewed', 'Job auto-renewed', _r.title, '/employer/jobs',
      jsonb_build_object('job_id', _r.id, 'expires_at', _r.expires_at));
  END LOOP;

  -- Pass 2: everything still past expiry (and not entitled) expires.
  FOR _r IN
    UPDATE public.jobs
      SET status = 'expired'
      WHERE id IN (
        SELECT j2.id FROM public.jobs j2
        WHERE j2.status = 'active' AND j2.expires_at <= now()
        FOR UPDATE OF j2
      )
      RETURNING id, company_id, title, applications_count
  LOOP
    _expired := _expired || jsonb_build_object(
      'job_id', _r.id, 'company_id', _r.company_id, 'title', _r.title,
      'applications_count', COALESCE(_r.applications_count, 0));
    PERFORM public.log_employer_activity(
      _r.company_id, NULL, 'job.expired', 'Job expired', _r.title, '/employer/jobs',
      jsonb_build_object('job_id', _r.id));
  END LOOP;

  RETURN jsonb_build_object('renewed', _renewed, 'expired', _expired);
END $$;
REVOKE ALL ON FUNCTION public.process_job_expiry_batch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_job_expiry_batch() TO service_role;

-- 8) Reminder dedup + atomic claim (one reminder per job per threshold).
CREATE TABLE IF NOT EXISTS public.job_expiry_reminders (
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  threshold_days integer NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, threshold_days)
);
GRANT ALL ON public.job_expiry_reminders TO service_role;
ALTER TABLE public.job_expiry_reminders ENABLE ROW LEVEL SECURITY;
-- Bookkeeping only (same pattern as alert_job_notifications): no user policies.

CREATE OR REPLACE FUNCTION public.claim_due_expiry_reminders()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _th int;
  _batch jsonb;
  _claimed jsonb := '[]'::jsonb;
BEGIN
  FOR _th IN
    SELECT unnest(COALESCE(
      (SELECT expiry_reminder_days FROM public.plan_settings WHERE id = 1),
      '{7,3,1}'::integer[]))
    ORDER BY 1 DESC
  LOOP
    WITH due AS (
      SELECT j.id, j.company_id, j.title, j.expires_at, j.auto_renew
      FROM public.jobs j
      WHERE j.status = 'active'
        AND j.expires_at > now()
        AND j.expires_at <= now() + (_th || ' days')::interval
        AND NOT EXISTS (
          SELECT 1 FROM public.job_expiry_reminders r
          WHERE r.job_id = j.id AND r.threshold_days = _th)
      FOR UPDATE OF j
    ), ins AS (
      INSERT INTO public.job_expiry_reminders (job_id, threshold_days)
      SELECT id, _th FROM due
      ON CONFLICT (job_id, threshold_days) DO NOTHING
      RETURNING job_id
    )
    SELECT jsonb_agg(jsonb_build_object(
      'job_id', d.id, 'company_id', d.company_id, 'title', d.title,
      'expires_at', d.expires_at, 'threshold_days', _th, 'auto_renew', d.auto_renew))
    INTO _batch
    FROM due d JOIN ins i ON i.job_id = d.id;

    _claimed := _claimed || COALESCE(_batch, '[]'::jsonb);
  END LOOP;
  RETURN _claimed;
END $$;
REVOKE ALL ON FUNCTION public.claim_due_expiry_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_expiry_reminders() TO service_role;

-- 9) feed_jobs(): add the read-time expiry guard (recreated verbatim from
--    20260924053114_job_boost_engine_ddl.sql plus one WHERE line).
CREATE OR REPLACE FUNCTION public.feed_jobs(
  _q text DEFAULT NULL,
  _city text DEFAULT NULL,
  _category text DEFAULT NULL,
  _job_type text DEFAULT NULL,
  _work_mode text DEFAULT NULL,
  _min_salary int DEFAULT NULL,
  _max_salary int DEFAULT NULL,
  _min_exp int DEFAULT NULL,
  _max_exp int DEFAULT NULL,
  _posted_after timestamptz DEFAULT NULL,
  _education text DEFAULT NULL,
  _shift text DEFAULT NULL,
  _english_level text DEFAULT NULL,
  _company text DEFAULT NULL,
  _vehicle boolean DEFAULT false,
  _verified_only boolean DEFAULT false,
  _limit int DEFAULT 50,
  _offset int DEFAULT 0
) RETURNS TABLE (
  id uuid,
  company_id uuid,
  title text,
  city text,
  state text,
  locality text,
  min_salary integer,
  max_salary integer,
  salary_period text,
  job_type text,
  work_mode text,
  min_experience_years integer,
  max_experience_years integer,
  education text,
  skills text[],
  created_at timestamptz,
  pay_type text,
  avg_incentive_monthly integer,
  company_name text,
  company_is_verified boolean,
  boosted boolean,
  score numeric,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH s AS (SELECT * FROM public.boost_settings WHERE id = 1),
  scored AS (
    SELECT
      j.id, j.company_id, j.title, j.city, j.state, j.locality,
      j.min_salary, j.max_salary, j.salary_period, j.job_type, j.work_mode,
      j.min_experience_years, j.max_experience_years, j.education, j.skills,
      j.created_at, j.pay_type, j.avg_incentive_monthly,
      c.name AS company_name, c.is_verified AS company_is_verified,
      lb.ends_at AS boost_ends_at,
      (
        CASE WHEN lb.ends_at IS NOT NULL AND lb.ends_at > now()
          THEN s.boost_weight * (
            extract(epoch FROM (lb.ends_at - now()))
            / GREATEST(extract(epoch FROM (lb.ends_at - lb.starts_at)), 1)
          )
          ELSE 0 END
        + s.freshness_weight * GREATEST(0, 1 - (extract(epoch FROM (now() - j.created_at)) / 86400.0) / 7)
        + s.quality_weight * (COALESCE(j.quality_score, 0) / 100.0)
      ) AS score
    FROM public.jobs j
    JOIN public.companies c ON c.id = j.company_id
    CROSS JOIN s
    LEFT JOIN LATERAL (
      SELECT jb.ends_at, jb.starts_at FROM public.job_boosts jb
      WHERE jb.job_id = j.id AND jb.ends_at > now()
      ORDER BY jb.ends_at DESC LIMIT 1
    ) lb ON true
    WHERE j.status = 'active'
      AND (j.expires_at IS NULL OR j.expires_at > now())
      AND (_q IS NULL OR j.title ILIKE '%' || _q || '%')
      AND (_city IS NULL OR j.city ILIKE '%' || _city || '%')
      AND (_category IS NULL OR j.category = _category)
      AND (_job_type IS NULL OR j.job_type::text = _job_type)
      AND (_work_mode IS NULL OR j.work_mode::text = _work_mode)
      AND (_min_salary IS NULL OR j.min_salary >= _min_salary)
      AND (_max_salary IS NULL OR j.max_salary <= _max_salary)
      AND (_max_exp IS NULL OR j.min_experience_years <= _max_exp)
      AND (_min_exp IS NULL OR j.max_experience_years >= _min_exp OR j.max_experience_years IS NULL)
      AND (_posted_after IS NULL OR j.created_at >= _posted_after)
      AND (_education IS NULL OR j.education = _education)
      AND (_shift IS NULL OR j.shift::text = _shift)
      AND (_english_level IS NULL OR j.english_level = _english_level)
      AND (_company IS NULL OR c.name ILIKE '%' || _company || '%')
      AND (_vehicle IS NOT TRUE OR j.required_assets @> ARRAY['Two-wheeler'])
      AND (_verified_only IS NOT TRUE OR c.is_verified = true)
  )
  SELECT
    id, company_id, title, city, state, locality, min_salary, max_salary, salary_period,
    job_type, work_mode, min_experience_years, max_experience_years, education, skills,
    created_at, pay_type, avg_incentive_monthly, company_name, company_is_verified,
    (boost_ends_at IS NOT NULL) AS boosted,
    score,
    count(*) OVER() AS total_count
  FROM scored
  ORDER BY score DESC, created_at DESC
  LIMIT _limit OFFSET _offset;
$$;

-- 10) pg_cron schedules (pg_cron/pg_net already enabled by
--     20260914075503_alert_job_notifications.sql; cron.schedule upserts by
--     job name so this stays re-runnable).
SELECT cron.schedule(
  'job-expiry-sweep',
  '5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://swdntxurukbkyksuyzhg.functions.supabase.co/job-expiry-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'job-expiry-reminders',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url := 'https://swdntxurukbkyksuyzhg.functions.supabase.co/job-expiry-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
