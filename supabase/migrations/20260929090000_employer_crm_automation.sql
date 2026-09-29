-- ============================================================================
-- Employer CRM & Automation — schema, settings, entitlements, SQL engine.
-- Implements employer-crm-automation-implementation.md (Phases 1-6 SQL layer).
--
-- Reuses (does NOT rebuild):
--   * applications + application_status enum as the pipeline (board = view).
--   * update_application_status() (20260929080000) for human stage moves —
--     its triggers already write application_status_history, candidate
--     notification and employer_activity('application.status_changed').
--   * candidate_unlocks / can_access_job_responses() for contact entitlement.
--   * notifications + pg_cron → pg_net → edge function claim pattern.
--
-- Adds: call_logs, follow_up_tasks, automation_rules, automation_runs,
--       crm_settings + 11 SECURITY DEFINER functions + 2 cron schedules.
-- Re-runnable: every statement is IF NOT EXISTS / OR REPLACE / ON CONFLICT.
-- ============================================================================

-- ── 1. Enums ────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.call_outcome AS ENUM (
    'connected_interested', 'connected_neutral', 'connected_not_interested',
    'no_answer', 'switched_off', 'wrong_number');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.followup_task_status AS ENUM ('open', 'done', 'snoozed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.crm_trigger AS ENUM (
    'application_uncontacted_h', 'call_no_answer', 'stage_stalled_h',
    'task_overdue_h', 'unlock_unused_h');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.crm_action AS ENUM ('create_task', 'notify', 'move_stage');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. Tables ───────────────────────────────────────────────────────────────
-- Call logs never store the phone number: contact entitlement is re-verified
-- at insert time (crm_log_call) and reads join masked profile fields.
CREATE TABLE IF NOT EXISTS public.call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  application_id uuid REFERENCES public.applications(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  caller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  outcome public.call_outcome NOT NULL,
  duration_sec integer CHECK (duration_sec IS NULL OR duration_sec >= 0),
  notes text,
  contact_source text NOT NULL CHECK (contact_source IN ('application', 'unlock')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_call_logs_company_time ON public.call_logs (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_logs_application ON public.call_logs (application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_logs_candidate ON public.call_logs (company_id, candidate_id);

CREATE TABLE IF NOT EXISTS public.follow_up_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.jobs(id) ON DELETE CASCADE,
  application_id uuid REFERENCES public.applications(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assignee_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL,
  body text,
  priority integer NOT NULL DEFAULT 1 CHECK (priority BETWEEN 0 AND 2),
  due_at timestamptz NOT NULL,
  status public.followup_task_status NOT NULL DEFAULT 'open',
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'call_log', 'automation', 'system')),
  source_ref uuid,
  due_notified_at timestamptz,
  completed_at timestamptz,
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_company_due ON public.follow_up_tasks (company_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_assignee ON public.follow_up_tasks (assignee_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_application ON public.follow_up_tasks (application_id);

CREATE TABLE IF NOT EXISTS public.automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  trigger public.crm_trigger NOT NULL,
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  action public.crm_action NOT NULL,
  action_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  cooldown_hours integer NOT NULL DEFAULT 24 CHECK (cooldown_hours >= 0),
  max_fires_per_lead integer NOT NULL DEFAULT 3 CHECK (max_fires_per_lead > 0),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_rules_company ON public.automation_rules (company_id, enabled, trigger);

-- Execution ledger. UNIQUE(rule_id, trigger_key) is the idempotency guard:
-- trigger_key encodes entity + window (e.g. 'app:<id>:uncontacted') so a rule
-- can never fire twice for the same entity/window even under concurrent ticks.
CREATE TABLE IF NOT EXISTS public.automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.automation_rules(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  application_id uuid,
  candidate_id uuid,
  trigger_key text NOT NULL,
  fired_at timestamptz NOT NULL DEFAULT now(),
  result text NOT NULL CHECK (result IN ('ok', 'skipped', 'error')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (rule_id, trigger_key)
);
CREATE INDEX IF NOT EXISTS idx_crm_runs_company_time ON public.automation_runs (company_id, fired_at DESC);

CREATE TABLE IF NOT EXISTS public.crm_settings (
  id integer PRIMARY KEY DEFAULT 1,
  weights jsonb NOT NULL,
  outcome_followup_hours jsonb NOT NULL,
  automation_batch integer NOT NULL DEFAULT 200,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_settings_singleton CHECK (id = 1)
);
INSERT INTO public.crm_settings (id, weights, outcome_followup_hours)
VALUES (
  1,
  '{"overdue_task":2,"unlock_unused":3,"applied_unviewed":2,"stage_stalled":2,"callback_due":3,"hot_stuck":2,"interview_unconfirmed":1}'::jsonb,
  '{"no_answer":48,"switched_off":24,"connected_neutral":24,"connected_interested":0,"connected_not_interested":0,"wrong_number":0}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- ── 3. RLS: members read, DEFINER RPCs write ────────────────────────────────
GRANT SELECT ON public.call_logs TO authenticated;
GRANT SELECT ON public.follow_up_tasks TO authenticated;
GRANT SELECT ON public.automation_rules TO authenticated;
GRANT SELECT ON public.automation_runs TO authenticated;
GRANT SELECT ON public.crm_settings TO authenticated;
GRANT ALL ON public.call_logs TO service_role;
GRANT ALL ON public.follow_up_tasks TO service_role;
GRANT ALL ON public.automation_rules TO service_role;
GRANT ALL ON public.automation_runs TO service_role;
GRANT ALL ON public.crm_settings TO service_role;

ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_up_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "crm members read call_logs" ON public.call_logs;
CREATE POLICY "crm members read call_logs" ON public.call_logs
  FOR SELECT TO authenticated
  USING (public.has_company_membership(auth.uid(), company_id));

DROP POLICY IF EXISTS "crm members read follow_up_tasks" ON public.follow_up_tasks;
CREATE POLICY "crm members read follow_up_tasks" ON public.follow_up_tasks
  FOR SELECT TO authenticated
  USING (public.has_company_membership(auth.uid(), company_id));

DROP POLICY IF EXISTS "crm members read automation_rules" ON public.automation_rules;
CREATE POLICY "crm members read automation_rules" ON public.automation_rules
  FOR SELECT TO authenticated
  USING (public.has_company_membership(auth.uid(), company_id));

DROP POLICY IF EXISTS "crm members read automation_runs" ON public.automation_runs;
CREATE POLICY "crm members read automation_runs" ON public.automation_runs
  FOR SELECT TO authenticated
  USING (public.has_company_membership(auth.uid(), company_id));

DROP POLICY IF EXISTS "crm settings readable" ON public.crm_settings;
CREATE POLICY "crm settings readable" ON public.crm_settings
  FOR SELECT TO authenticated USING (true);

-- No INSERT/UPDATE/DELETE policies for authenticated on any of the four
-- CRM tables: every write path is a SECURITY DEFINER function below, which
-- re-checks membership/role and writes the employer_activity audit row.

-- ── 4. Plan gating: limits key + platform defaults ─────────────────────────
ALTER TABLE public.plan_settings
  ADD COLUMN IF NOT EXISTS crm_automation_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS crm_automation_rules_max integer NOT NULL DEFAULT 3;

-- Basic gets no automation (upgrade lever), Regular 3 rules, Unlimited a
-- generous but real cap (monetization guardrails forbid literal unlimited).
UPDATE public.plans SET limits = jsonb_set(COALESCE(limits, '{}'::jsonb), '{crm_automation_rules_max}', '0')
  WHERE name = 'Basic' AND is_custom = false;
UPDATE public.plans SET limits = jsonb_set(COALESCE(limits, '{}'::jsonb), '{crm_automation_rules_max}', '3')
  WHERE name = 'Regular' AND is_custom = false;
UPDATE public.plans SET limits = jsonb_set(COALESCE(limits, '{}'::jsonb), '{crm_automation_rules_max}', '30')
  WHERE name = 'Unlimited' AND is_custom = false;

-- ── 5. company_crm_entitlement — COALESCE(plan limit, platform default) ────
CREATE OR REPLACE FUNCTION public.company_crm_entitlement(_company_id uuid)
RETURNS TABLE (automation_enabled boolean, rules_max integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    ps.crm_automation_enabled
      AND COALESCE((p.limits ->> 'crm_automation_rules_max')::int, ps.crm_automation_rules_max) <> 0,
    COALESCE((p.limits ->> 'crm_automation_rules_max')::int, ps.crm_automation_rules_max)
  FROM public.plan_settings ps
  LEFT JOIN public.company_plans cp
    ON cp.company_id = _company_id AND cp.status = 'active'
  LEFT JOIN public.plans p ON p.id = cp.plan_id
  WHERE ps.id = 1;
$$;
REVOKE ALL ON FUNCTION public.company_crm_entitlement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_crm_entitlement(uuid) TO authenticated, service_role;

-- ── 6. crm_log_call — telecaller log + auto follow-up ──────────────────────
CREATE OR REPLACE FUNCTION public.crm_log_call(
  _company_id uuid,
  _candidate_id uuid,
  _outcome public.call_outcome,
  _application_id uuid DEFAULT NULL,
  _job_id uuid DEFAULT NULL,
  _notes text DEFAULT NULL,
  _duration_sec integer DEFAULT NULL,
  _follow_up_at timestamptz DEFAULT NULL,
  _actor uuid DEFAULT auth.uid()
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _job uuid;
  _allowed boolean := false;
  _call_id uuid;
  _task_id uuid;
  _hours int;
  _due timestamptz;
  _name text;
BEGIN
  IF NOT public.has_company_membership(_actor, _company_id) THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;

  IF _application_id IS NOT NULL THEN
    SELECT a.job_id INTO _job FROM public.applications a
     WHERE a.id = _application_id AND a.company_id = _company_id;
    IF _job IS NULL THEN RAISE EXCEPTION 'application_not_found'; END IF;
    _allowed := public.can_access_job_responses(_job);
  ELSE
    _job := _job_id;
    _allowed := EXISTS (
      SELECT 1 FROM public.candidate_unlocks u
       WHERE u.company_id = _company_id AND u.candidate_user_id = _candidate_id);
  END IF;
  IF NOT _allowed THEN RAISE EXCEPTION 'contact_not_unlocked'; END IF;

  INSERT INTO public.call_logs
    (company_id, job_id, application_id, candidate_id, caller_id, outcome,
     duration_sec, notes, contact_source)
  VALUES
    (_company_id, _job, _application_id, _candidate_id, _actor, _outcome,
     _duration_sec, _notes,
     CASE WHEN _application_id IS NOT NULL THEN 'application' ELSE 'unlock' END)
  RETURNING id INTO _call_id;

  -- Outcome → default follow-up delay (crm_settings), explicit time wins.
  IF _follow_up_at IS NOT NULL THEN
    _due := _follow_up_at;
  ELSE
    SELECT (outcome_followup_hours ->> _outcome::text)::int INTO _hours
      FROM public.crm_settings WHERE id = 1;
    IF COALESCE(_hours, 0) > 0 THEN
      _due := now() + make_interval(hours => _hours);
    END IF;
  END IF;

  IF _due IS NOT NULL THEN
    SELECT full_name INTO _name FROM public.profiles WHERE id = _candidate_id;
    INSERT INTO public.follow_up_tasks
      (company_id, job_id, application_id, candidate_id, assignee_id, title,
       priority, due_at, source, source_ref, created_by)
    VALUES
      (_company_id, _job, _application_id, _candidate_id, _actor,
       'Call back ' || COALESCE(_name, 'candidate'),
       1, _due, 'call_log', _call_id, _actor)
    RETURNING id INTO _task_id;
  END IF;

  PERFORM public.log_employer_activity(
    _company_id, _actor, 'crm_call_logged', 'Call logged',
    COALESCE(_name, 'A candidate') || ' — ' || _outcome::text,
    '/employer/crm',
    jsonb_build_object('call_id', _call_id, 'candidate_id', _candidate_id,
                       'job_id', _job, 'outcome', _outcome::text,
                       'task_id', _task_id));

  RETURN jsonb_build_object('call_id', _call_id, 'task_id', _task_id);
END; $$;
REVOKE ALL ON FUNCTION public.crm_log_call(uuid, uuid, public.call_outcome, uuid, uuid, text, integer, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_log_call(uuid, uuid, public.call_outcome, uuid, uuid, text, integer, timestamptz, uuid) TO authenticated;

-- ── 7. Tasks ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_save_task(
  _company_id uuid,
  _candidate_id uuid,
  _title text,
  _due_at timestamptz,
  _task_id uuid DEFAULT NULL,
  _application_id uuid DEFAULT NULL,
  _job_id uuid DEFAULT NULL,
  _body text DEFAULT NULL,
  _priority integer DEFAULT 1,
  _assignee_id uuid DEFAULT NULL,
  _actor uuid DEFAULT auth.uid()
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _new_id uuid;
BEGIN
  IF NOT public.has_company_membership(_actor, _company_id) THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;

  IF _task_id IS NOT NULL THEN
    SELECT id INTO _new_id FROM public.follow_up_tasks
     WHERE id = _task_id AND company_id = _company_id;
    IF _new_id IS NULL THEN RAISE EXCEPTION 'task_not_found'; END IF;
    UPDATE public.follow_up_tasks
       SET title = _title, body = _body, priority = _priority,
           assignee_id = _assignee_id, due_at = _due_at,
           application_id = _application_id, job_id = _job_id,
           due_notified_at = CASE WHEN due_at IS DISTINCT FROM _due_at
                                  THEN NULL ELSE due_notified_at END,
           updated_at = now()
     WHERE id = _task_id;
  ELSE
    INSERT INTO public.follow_up_tasks
      (company_id, job_id, application_id, candidate_id, assignee_id, title,
       body, priority, due_at, source, created_by)
    VALUES
      (_company_id, _job_id, _application_id, _candidate_id, _assignee_id,
       _title, _body, _priority, _due_at, 'manual', _actor)
    RETURNING id INTO _new_id;
    PERFORM public.log_employer_activity(
      _company_id, _actor, 'crm_task_created', 'Follow-up scheduled',
      _title, '/employer/crm',
      jsonb_build_object('task_id', _new_id, 'candidate_id', _candidate_id,
                         'due_at', _due_at));
  END IF;
  RETURN _new_id;
END; $$;
REVOKE ALL ON FUNCTION public.crm_save_task(uuid, uuid, text, timestamptz, uuid, uuid, uuid, text, integer, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_save_task(uuid, uuid, text, timestamptz, uuid, uuid, uuid, text, integer, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_set_task_status(
  _task_id uuid,
  _status public.followup_task_status,
  _new_due_at timestamptz DEFAULT NULL,
  _actor uuid DEFAULT auth.uid()
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _company uuid;
BEGIN
  SELECT company_id INTO _company FROM public.follow_up_tasks WHERE id = _task_id;
  IF _company IS NULL THEN RAISE EXCEPTION 'task_not_found'; END IF;
  IF NOT public.has_company_membership(_actor, _company) THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;
  IF _status = 'snoozed' AND _new_due_at IS NULL THEN
    RAISE EXCEPTION 'snooze_needs_due_date';
  END IF;

  UPDATE public.follow_up_tasks
     SET status = _status,
         due_at = CASE WHEN _status = 'snoozed' THEN _new_due_at ELSE due_at END,
         due_notified_at = CASE WHEN _status = 'snoozed' THEN NULL ELSE due_notified_at END,
         completed_at = CASE WHEN _status = 'done' THEN now() ELSE completed_at END,
         completed_by = CASE WHEN _status = 'done' THEN _actor ELSE completed_by END,
         updated_at = now()
   WHERE id = _task_id;

  PERFORM public.log_employer_activity(
    _company, _actor,
    CASE _status WHEN 'done' THEN 'crm_task_completed'
                 WHEN 'snoozed' THEN 'crm_task_snoozed'
                 ELSE 'crm_task_updated' END,
    'Follow-up ' || _status::text,
    (SELECT title FROM public.follow_up_tasks WHERE id = _task_id),
    '/employer/crm', jsonb_build_object('task_id', _task_id));
END; $$;
REVOKE ALL ON FUNCTION public.crm_set_task_status(uuid, public.followup_task_status, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_set_task_status(uuid, public.followup_task_status, timestamptz, uuid) TO authenticated;

-- Atomic claim for the reminder edge function: due_notified_at flips inside
-- the same UPDATE that returns the rows, so cron retries never double-notify.
CREATE OR REPLACE FUNCTION public.claim_due_crm_tasks()
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH claimed AS (
    UPDATE public.follow_up_tasks
       SET due_notified_at = now()
     WHERE status = 'open' AND due_at <= now() AND due_notified_at IS NULL
    RETURNING id, company_id, assignee_id, created_by, title, candidate_id,
              job_id, application_id, due_at
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb) FROM claimed c;
$$;
REVOKE ALL ON FUNCTION public.claim_due_crm_tasks() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_crm_tasks() TO service_role;

-- ── 8. get_crm_leads — derived lead inbox (applications ∪ unlocks) ────────
CREATE OR REPLACE FUNCTION public.get_crm_leads(
  _company_id uuid,
  _job_id uuid DEFAULT NULL,
  _source text DEFAULT NULL,
  _stage text DEFAULT NULL,
  _contacted boolean DEFAULT NULL,
  _limit integer DEFAULT 50,
  _offset integer DEFAULT 0
)
RETURNS TABLE (
  candidate_id uuid,
  application_id uuid,
  source text,
  stage text,
  job_id uuid,
  job_title text,
  full_name text,
  city text,
  avatar_url text,
  headline text,
  applied_at timestamptz,
  unlocked_at timestamptz,
  contacted boolean,
  last_call_at timestamptz,
  last_outcome text,
  open_tasks integer,
  next_follow_up_at timestamptz,
  total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_company_membership(auth.uid(), _company_id) THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;

  RETURN QUERY
  WITH app AS (
    SELECT DISTINCT ON (a.candidate_id)
           a.id AS application_id, a.candidate_id, a.job_id,
           a.status::text AS status, a.created_at
      FROM public.applications a
     WHERE a.company_id = _company_id
     ORDER BY a.candidate_id, a.created_at DESC
  ), unk AS (
    SELECT DISTINCT ON (u.candidate_user_id)
           u.candidate_user_id, u.created_at AS unlocked_at, u.job_id
      FROM public.candidate_unlocks u
     WHERE u.company_id = _company_id
     ORDER BY u.candidate_user_id, u.created_at DESC
  ), leads AS (
    SELECT
      COALESCE(app.candidate_id, unk.candidate_user_id) AS candidate_id,
      app.application_id,
      CASE WHEN app.candidate_id IS NOT NULL AND unk.candidate_user_id IS NOT NULL THEN 'both'
           WHEN app.candidate_id IS NOT NULL THEN 'application'
           ELSE 'unlock' END AS source,
      COALESCE(app.status, 'new') AS stage,
      COALESCE(app.job_id, unk.job_id) AS job_id,
      app.created_at AS applied_at,
      unk.unlocked_at
    FROM app
    FULL OUTER JOIN unk ON unk.candidate_user_id = app.candidate_id
  )
  SELECT
    l.candidate_id,
    l.application_id,
    l.source,
    l.stage,
    l.job_id,
    j.title,
    p.full_name,
    p.city,
    p.avatar_url,
    cp.headline,
    l.applied_at,
    l.unlocked_at,
    EXISTS (SELECT 1 FROM public.call_logs c
             WHERE c.company_id = _company_id AND c.candidate_id = l.candidate_id),
    (SELECT max(c.created_at) FROM public.call_logs c
      WHERE c.company_id = _company_id AND c.candidate_id = l.candidate_id),
    (SELECT c.outcome::text FROM public.call_logs c
      WHERE c.company_id = _company_id AND c.candidate_id = l.candidate_id
      ORDER BY c.created_at DESC LIMIT 1),
    (SELECT count(*)::int FROM public.follow_up_tasks t
      WHERE t.company_id = _company_id AND t.candidate_id = l.candidate_id
        AND t.status = 'open'),
    (SELECT min(t.due_at) FROM public.follow_up_tasks t
      WHERE t.company_id = _company_id AND t.candidate_id = l.candidate_id
        AND t.status = 'open'),
    count(*) OVER() AS total_count
  FROM leads l
  LEFT JOIN public.jobs j ON j.id = l.job_id
  LEFT JOIN public.profiles p ON p.id = l.candidate_id
  LEFT JOIN public.candidate_profiles cp ON cp.user_id = l.candidate_id
  WHERE (_job_id IS NULL OR l.job_id = _job_id)
    AND (_source IS NULL OR l.source = _source)
    AND (_stage IS NULL OR l.stage = _stage)
    AND (_contacted IS NULL
         OR EXISTS (SELECT 1 FROM public.call_logs c
                     WHERE c.company_id = _company_id
                       AND c.candidate_id = l.candidate_id) = _contacted)
  ORDER BY next_follow_up_at ASC NULLS LAST,
           COALESCE(l.applied_at, l.unlocked_at) DESC NULLS LAST
  LIMIT _limit OFFSET _offset;
END; $$;
REVOKE ALL ON FUNCTION public.get_crm_leads(uuid, uuid, text, text, boolean, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crm_leads(uuid, uuid, text, text, boolean, integer, integer) TO authenticated;

-- ── 9. Rules CRUD ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_save_rule(
  _company_id uuid,
  _name text,
  _trigger public.crm_trigger,
  _action public.crm_action,
  _enabled boolean,
  _rule_id uuid DEFAULT NULL,
  _conditions jsonb DEFAULT '{}'::jsonb,
  _action_payload jsonb DEFAULT '{}'::jsonb,
  _cooldown_hours integer DEFAULT 24,
  _max_fires_per_lead integer DEFAULT 3,
  _actor uuid DEFAULT auth.uid()
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _new_id uuid := _rule_id;
  _ent record;
  _enabled_count int;
BEGIN
  IF NOT public.has_company_membership(_actor, _company_id) THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;
  -- Rules are an admin-level lever: recruiters can work the pipeline but
  -- not rewire the automation engine.
  IF NOT (public.has_company_role(_company_id, 'hr_admin', _actor)
          OR public.has_company_role(_company_id, 'super_admin', _actor)) THEN
    RAISE EXCEPTION 'insufficient_role';
  END IF;

  SELECT * INTO _ent FROM public.company_crm_entitlement(_company_id);
  IF _enabled AND NOT _ent.automation_enabled THEN
    RAISE EXCEPTION 'automation_disabled';
  END IF;

  IF _rule_id IS NOT NULL THEN
    SELECT id INTO _new_id FROM public.automation_rules
     WHERE id = _rule_id AND company_id = _company_id;
    IF _new_id IS NULL THEN RAISE EXCEPTION 'rule_not_found'; END IF;
  END IF;

  IF _enabled THEN
    SELECT count(*) INTO _enabled_count FROM public.automation_rules
     WHERE company_id = _company_id AND enabled AND id IS DISTINCT FROM _new_id;
    IF _ent.rules_max >= 0 AND _enabled_count >= _ent.rules_max THEN
      RAISE EXCEPTION 'rule_limit_reached';
    END IF;
  END IF;

  IF _rule_id IS NOT NULL THEN
    UPDATE public.automation_rules
       SET name = _name, trigger = _trigger, conditions = _conditions,
           action = _action, action_payload = _action_payload,
           enabled = _enabled, cooldown_hours = _cooldown_hours,
           max_fires_per_lead = _max_fires_per_lead, updated_at = now()
     WHERE id = _rule_id;
  ELSE
    INSERT INTO public.automation_rules
      (company_id, name, trigger, conditions, action, action_payload,
       enabled, cooldown_hours, max_fires_per_lead, created_by)
    VALUES
      (_company_id, _name, _trigger, _conditions, _action, _action_payload,
       _enabled, _cooldown_hours, _max_fires_per_lead, _actor)
    RETURNING id INTO _new_id;
  END IF;

  PERFORM public.log_employer_activity(
    _company_id, _actor,
    CASE WHEN _enabled THEN 'crm_rule_saved' ELSE 'crm_rule_toggled' END,
    CASE WHEN _enabled THEN 'Automation rule saved' ELSE 'Automation rule paused' END,
    _name || ' (' || _trigger::text || ' → ' || _action::text || ')',
    '/employer/crm/automation',
    jsonb_build_object('rule_id', _new_id, 'enabled', _enabled));

  RETURN _new_id;
END; $$;
REVOKE ALL ON FUNCTION public.crm_save_rule(uuid, text, public.crm_trigger, public.crm_action, boolean, uuid, jsonb, jsonb, integer, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_save_rule(uuid, text, public.crm_trigger, public.crm_action, boolean, uuid, jsonb, jsonb, integer, integer, uuid) TO authenticated;

-- Three seeded templates on first visit — the editor is never blank.
CREATE OR REPLACE FUNCTION public.crm_ensure_default_rules(
  _company_id uuid,
  _actor uuid DEFAULT auth.uid()
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _n int;
BEGIN
  IF NOT public.has_company_membership(_actor, _company_id) THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;
  SELECT count(*) INTO _n FROM public.automation_rules WHERE company_id = _company_id;
  IF _n > 0 THEN RETURN 0; END IF;

  INSERT INTO public.automation_rules
    (company_id, name, trigger, conditions, action, action_payload, enabled, created_by)
  VALUES
    (_company_id, 'New applicant uncontacted for 24h', 'application_uncontacted_h',
     '{"hours":24}'::jsonb, 'create_task',
     '{"hours_until_due":24,"title":"Call new applicant"}'::jsonb, true, _actor),
    (_company_id, 'No-answer call → schedule call-back', 'call_no_answer',
     '{"hours":4}'::jsonb, 'create_task',
     '{"hours_until_due":48,"title":"Call back (no answer)"}'::jsonb, true, _actor),
    (_company_id, 'Shortlisted 3 days without interview', 'stage_stalled_h',
     '{"hours":72}'::jsonb, 'notify', '{}'::jsonb, true, _actor);
  RETURN 3;
END; $$;
REVOKE ALL ON FUNCTION public.crm_ensure_default_rules(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_ensure_default_rules(uuid, uuid) TO authenticated;

-- ── 10. crm_tick_automation — the rule engine ──────────────────────────────
-- Candidate set per trigger. Static SQL per branch (no dynamic SQL), each
-- index-scoped to the rule's company.
CREATE OR REPLACE FUNCTION public.crm_rule_candidates(
  _company_id uuid,
  _trigger public.crm_trigger,
  _conditions jsonb,
  _limit integer
)
RETURNS TABLE (application_id uuid, candidate_id uuid, trigger_key text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _hours int;
BEGIN
  _hours := COALESCE((_conditions ->> 'hours')::int,
    CASE _trigger
      WHEN 'application_uncontacted_h' THEN 24
      WHEN 'call_no_answer' THEN 4
      WHEN 'stage_stalled_h' THEN 72
      WHEN 'task_overdue_h' THEN 24
      WHEN 'unlock_unused_h' THEN 48
    END);

  IF _trigger = 'application_uncontacted_h' THEN
    RETURN QUERY
    SELECT a.id, a.candidate_id, 'app:' || a.id::text || ':uncontacted'
      FROM public.applications a
     WHERE a.company_id = _company_id
       AND a.status IN ('applied', 'shortlisted')
       AND a.created_at <= now() - make_interval(hours => _hours)
       AND NOT EXISTS (SELECT 1 FROM public.call_logs c
                        WHERE c.company_id = _company_id
                          AND c.candidate_id = a.candidate_id)
     LIMIT _limit;
  ELSIF _trigger = 'call_no_answer' THEN
    RETURN QUERY
    SELECT c.application_id, c.candidate_id, 'call:' || c.id::text
      FROM public.call_logs c
     WHERE c.company_id = _company_id
       AND c.outcome IN ('no_answer', 'switched_off')
       AND c.created_at <= now() - make_interval(hours => _hours)
       AND NOT EXISTS (SELECT 1 FROM public.follow_up_tasks t
                        WHERE t.source_ref = c.id AND t.status = 'open')
     LIMIT _limit;
  ELSIF _trigger = 'stage_stalled_h' THEN
    RETURN QUERY
    SELECT a.id, a.candidate_id, 'app:' || a.id::text || ':stalled'
      FROM public.applications a
     WHERE a.company_id = _company_id
       AND a.status = 'shortlisted'
       AND NOT EXISTS (SELECT 1 FROM public.interviews i WHERE i.application_id = a.id)
       AND (SELECT max(h.created_at) FROM public.application_status_history h
             WHERE h.application_id = a.id AND h.to_status = 'shortlisted')
           <= now() - make_interval(hours => _hours)
     LIMIT _limit;
  ELSIF _trigger = 'task_overdue_h' THEN
    RETURN QUERY
    SELECT t.application_id, t.candidate_id, 'task:' || t.id::text
      FROM public.follow_up_tasks t
     WHERE t.company_id = _company_id
       AND t.status = 'open'
       AND t.due_at <= now() - make_interval(hours => _hours)
     LIMIT _limit;
  ELSIF _trigger = 'unlock_unused_h' THEN
    RETURN QUERY
    SELECT NULL::uuid, u.candidate_user_id, 'unlock:' || u.id::text
      FROM public.candidate_unlocks u
     WHERE u.company_id = _company_id
       AND u.created_at <= now() - make_interval(hours => _hours)
       AND NOT EXISTS (SELECT 1 FROM public.call_logs c
                        WHERE c.company_id = _company_id
                          AND c.candidate_id = u.candidate_user_id)
     LIMIT _limit;
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.crm_rule_candidates(uuid, public.crm_trigger, jsonb, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_rule_candidates(uuid, public.crm_trigger, jsonb, integer) TO service_role;

-- Called by the crm-automation-tick edge function (pg_cron, service_role).
-- FOR UPDATE SKIP LOCKED keeps concurrent ticks disjoint; the runs ledger's
-- UNIQUE(rule_id, trigger_key) makes every fire exactly-once per entity.
CREATE OR REPLACE FUNCTION public.crm_tick_automation(_batch integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _rule record;
  _cand record;
  _hours int;
  _evaluated int := 0;
  _fired int := 0;
  _skipped int := 0;
  _errors int := 0;
  _remaining int := _batch;
  _job uuid;
  _cur_status public.application_status;
  _to_status text;
  _title text;
  _due_h int;
BEGIN
  FOR _rule IN
    SELECT * FROM public.automation_rules WHERE enabled
     ORDER BY created_at
     FOR UPDATE SKIP LOCKED
  LOOP
    _evaluated := _evaluated + 1;
    IF _remaining <= 0 THEN EXIT; END IF;

    FOR _cand IN
      SELECT * FROM public.crm_rule_candidates(_rule.company_id,
                 _rule.trigger, _rule.conditions, _remaining)
    LOOP
      -- Already fired for this entity/window?
      IF EXISTS (SELECT 1 FROM public.automation_runs r
                  WHERE r.rule_id = _rule.id AND r.trigger_key = _cand.trigger_key) THEN
        _skipped := _skipped + 1;
        CONTINUE;
      END IF;
      -- Cooldown per (rule, candidate).
      IF _rule.cooldown_hours > 0 AND EXISTS (
        SELECT 1 FROM public.automation_runs r
         WHERE r.rule_id = _rule.id AND r.candidate_id = _cand.candidate_id
           AND r.result = 'ok'
           AND r.fired_at > now() - make_interval(hours => _rule.cooldown_hours)) THEN
        _skipped := _skipped + 1;
        CONTINUE;
      END IF;
      -- Per-lead fire cap.
      IF EXISTS (
        SELECT 1 FROM public.automation_runs r
         WHERE r.rule_id = _rule.id AND r.candidate_id = _cand.candidate_id
           AND r.result = 'ok'
         HAVING count(*) >= _rule.max_fires_per_lead) THEN
        _skipped := _skipped + 1;
        CONTINUE;
      END IF;

      BEGIN
        IF _rule.action = 'create_task' THEN
          _title := COALESCE(_rule.action_payload ->> 'title', 'Follow up');
          _due_h := COALESCE((_rule.action_payload ->> 'hours_until_due')::int, 24);
          SELECT a.job_id INTO _job FROM public.applications a
           WHERE a.id = _cand.application_id;
          INSERT INTO public.follow_up_tasks
            (company_id, job_id, application_id, candidate_id, title, body,
             priority, due_at, source, source_ref, created_by)
          VALUES
            (_rule.company_id, _job, _cand.application_id, _cand.candidate_id,
             _title, 'Auto-created by "' || _rule.name || '"',
             COALESCE((_rule.action_payload ->> 'priority')::int, 1),
             now() + make_interval(hours => _due_h),
             'automation', _rule.id, _rule.created_by);
        ELSIF _rule.action = 'notify' THEN
          INSERT INTO public.notifications (user_id, type, title, body, link)
          SELECT em.user_id, 'crm.automation', _rule.name,
                 'Automation "' || _rule.name || '" needs your attention.',
                 '/employer/crm/automation'
            FROM public.employer_members em
           WHERE em.company_id = _rule.company_id
             AND em.role IN ('super_admin', 'hr_admin');
        ELSIF _rule.action = 'move_stage' THEN
          _to_status := _rule.action_payload ->> 'to_status';
          IF _cand.application_id IS NOT NULL
             AND _to_status IN ('applied', 'shortlisted', 'interview') THEN
            SELECT a.status INTO _cur_status FROM public.applications a
             WHERE a.id = _cand.application_id
               FOR UPDATE;
            IF _cur_status NOT IN ('hired', 'rejected', 'withdrawn')
               AND _cur_status::text <> _to_status THEN
              UPDATE public.applications SET status = _to_status::public.application_status
               WHERE id = _cand.application_id;
            END IF;
          END IF;
        END IF;

        INSERT INTO public.automation_runs
          (rule_id, company_id, application_id, candidate_id, trigger_key, result, detail)
        VALUES
          (_rule.id, _rule.company_id, _cand.application_id, _cand.candidate_id,
           _cand.trigger_key, 'ok',
           jsonb_build_object('action', _rule.action::text, 'at', now()))
        ON CONFLICT (rule_id, trigger_key) DO NOTHING;

        PERFORM public.log_employer_activity(
          _rule.company_id, NULL, 'crm_automation_fired', 'Automation fired',
          _rule.name || ' → ' || _rule.action::text,
          '/employer/crm/automation',
          jsonb_build_object('rule_id', _rule.id, 'trigger_key', _cand.trigger_key,
                             'candidate_id', _cand.candidate_id));

        _fired := _fired + 1;
        _remaining := _remaining - 1;
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.automation_runs
          (rule_id, company_id, application_id, candidate_id, trigger_key, result, detail)
        VALUES
          (_rule.id, _rule.company_id, _cand.application_id, _cand.candidate_id,
           _cand.trigger_key, 'error',
           jsonb_build_object('error', SQLERRMSG, 'at', now()))
        ON CONFLICT (rule_id, trigger_key)
          DO UPDATE SET result = 'error',
                        detail = jsonb_build_object('error', SQLERRMSG, 'at', now());
        _errors := _errors + 1;
      END;
      IF _remaining <= 0 THEN EXIT; END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('rules_evaluated', _evaluated, 'fired', _fired,
                            'skipped', _skipped, 'errors', _errors);
END; $$;
REVOKE ALL ON FUNCTION public.crm_tick_automation(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_tick_automation(integer) TO service_role;

-- ── 11. get_crm_next_best_actions — the "work queue" ───────────────────────
CREATE OR REPLACE FUNCTION public.get_crm_next_best_actions(
  _company_id uuid,
  _limit integer DEFAULT 8
)
RETURNS TABLE (
  kind text,
  score integer,
  reason text,
  application_id uuid,
  candidate_id uuid,
  job_id uuid,
  link text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _w jsonb;
BEGIN
  IF NOT public.has_company_membership(auth.uid(), _company_id) THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;
  SELECT weights INTO _w FROM public.crm_settings WHERE id = 1;

  RETURN QUERY
  SELECT s.kind, s.score, s.reason, s.application_id, s.candidate_id, s.job_id, s.link
  FROM (
    SELECT 'overdue_task'::text AS kind,
           COALESCE((_w ->> 'overdue_task')::int, 2)
             + GREATEST(1, EXTRACT(DAY FROM (now() - t.due_at))::int) AS score,
           'Follow-up "' || t.title || '" is overdue by '
             || GREATEST(1, EXTRACT(DAY FROM (now() - t.due_at))::int) || 'd' AS reason,
           t.application_id, t.candidate_id, t.job_id,
           '/employer/crm'::text AS link
      FROM public.follow_up_tasks t
     WHERE t.company_id = _company_id AND t.status = 'open' AND t.due_at < now()

    UNION ALL
    SELECT 'callback_due',
           COALESCE((_w ->> 'callback_due')::int, 3),
           'Promised call-back window reached for "' || t.title || '"',
           t.application_id, t.candidate_id, t.job_id, '/employer/crm'
      FROM public.follow_up_tasks t
     WHERE t.company_id = _company_id AND t.status = 'open'
       AND t.source = 'call_log'
       AND t.due_at BETWEEN now() AND now() + interval '6 hours'

    UNION ALL
    SELECT 'unlock_unused',
           COALESCE((_w ->> 'unlock_unused')::int, 3),
           'Unlocked ' || GREATEST(1, EXTRACT(DAY FROM (now() - u.created_at))::int)
             || 'd ago and never called',
           NULL, u.candidate_user_id, u.job_id, '/employer/crm'
      FROM public.candidate_unlocks u
     WHERE u.company_id = _company_id
       AND u.created_at <= now() - interval '24 hours'
       AND NOT EXISTS (SELECT 1 FROM public.call_logs c
                        WHERE c.company_id = _company_id
                          AND c.candidate_id = u.candidate_user_id)

    UNION ALL
    SELECT 'applied_unviewed',
           COALESCE((_w ->> 'applied_unviewed')::int, 2),
           'Application waiting ' || GREATEST(2, EXTRACT(DAY FROM (now() - a.created_at))::int)
             || 'd — not viewed yet',
           a.id, a.candidate_id, a.job_id,
           '/employer/jobs/' || a.job_id::text || '/applicants'
      FROM public.applications a
     WHERE a.company_id = _company_id AND a.status = 'applied'
       AND a.viewed_by_employer_at IS NULL
       AND a.created_at <= now() - interval '48 hours'

    UNION ALL
    SELECT 'stage_stalled',
           COALESCE((_w ->> 'stage_stalled')::int, 2),
           'Shortlisted 3d+ with no interview scheduled',
           a.id, a.candidate_id, a.job_id,
           '/employer/jobs/' || a.job_id::text || '/applicants'
      FROM public.applications a
     WHERE a.company_id = _company_id AND a.status = 'shortlisted'
       AND NOT EXISTS (SELECT 1 FROM public.interviews i WHERE i.application_id = a.id)
       AND (SELECT max(h.created_at) FROM public.application_status_history h
             WHERE h.application_id = a.id AND h.to_status = 'shortlisted')
           <= now() - interval '3 days'

    UNION ALL
    SELECT 'hot_stuck',
           COALESCE((_w ->> 'hot_stuck')::int, 2),
           'Strong match (' || m.score::text || '/100) still sitting in Applied',
           a.id, a.candidate_id, a.job_id,
           '/employer/jobs/' || a.job_id::text || '/applicants'
      FROM public.applications a
      JOIN public.application_match_scores m ON m.application_id = a.id
     WHERE a.company_id = _company_id AND a.status = 'applied'
       AND COALESCE(m.score, 0) >= 70

    UNION ALL
    SELECT 'interview_unconfirmed',
           COALESCE((_w ->> 'interview_unconfirmed')::int, 1),
           'Interview tomorrow is still unconfirmed',
           i.application_id, i.candidate_id, i.job_id, '/employer/interviews'
      FROM public.interviews i
     WHERE i.company_id = _company_id AND i.status = 'scheduled'
       AND i.scheduled_at BETWEEN now() AND now() + interval '1 day'
  ) s
  ORDER BY s.score DESC
  LIMIT _limit;
END; $$;
REVOKE ALL ON FUNCTION public.get_crm_next_best_actions(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crm_next_best_actions(uuid, integer) TO authenticated;

-- ── 12. Admin settings ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_admin_update_settings(
  _weights jsonb,
  _outcome_hours jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_platform_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'insufficient_role';
  END IF;
  UPDATE public.crm_settings
     SET weights = _weights, outcome_followup_hours = _outcome_hours,
         updated_at = now()
   WHERE id = 1;
END; $$;
REVOKE ALL ON FUNCTION public.crm_admin_update_settings(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_update_settings(jsonb, jsonb) TO authenticated;

-- ── 13. pg_cron schedules (pg_cron/pg_net enabled by 20260914075503) ───────
SELECT cron.schedule(
  'crm-task-reminders',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://swdntxurukbkyksuyzhg.functions.supabase.co/crm-task-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'crm-automation-tick',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://swdntxurukbkyksuyzhg.functions.supabase.co/crm-automation-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
