-- The Follow-up Calendar (Part C of its implementation prompt) wants a
-- "follow-up type" (Call / Interview Follow-up / Send Message / Check
-- Application / Other) that follow_up_tasks doesn't have — every other
-- field it needs (candidate/job/application association, due_at, status,
-- priority, assignee, notes) already exists.

ALTER TABLE public.follow_up_tasks
  ADD COLUMN IF NOT EXISTS task_type text NOT NULL DEFAULT 'call';

DO $$ BEGIN
  ALTER TABLE public.follow_up_tasks
    ADD CONSTRAINT follow_up_tasks_task_type_check
    CHECK (task_type IN ('call', 'interview_followup', 'send_message', 'check_application', 'other'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- crm_save_task: adds a trailing _task_type param. A new parameter changes
-- the function's full type signature, so CREATE OR REPLACE alone would add
-- a second overload rather than replace the original — explicitly drop the
-- old 11-arg signature first so exactly one version exists going forward
-- (the updated saveTask server fn always sends _task_type, so there's no
-- need to keep the old overload around for backward compatibility).
DROP FUNCTION IF EXISTS public.crm_save_task(uuid, uuid, text, timestamptz, uuid, uuid, uuid, text, integer, uuid, uuid);

CREATE FUNCTION public.crm_save_task(
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
  _actor uuid DEFAULT auth.uid(),
  _task_type text DEFAULT 'call'
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _new_id uuid;
BEGIN
  IF NOT public.has_company_membership(_actor, _company_id) THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;
  IF _task_type NOT IN ('call', 'interview_followup', 'send_message', 'check_application', 'other') THEN
    RAISE EXCEPTION 'invalid_task_type';
  END IF;

  IF _task_id IS NOT NULL THEN
    SELECT id INTO _new_id FROM public.follow_up_tasks
     WHERE id = _task_id AND company_id = _company_id;
    IF _new_id IS NULL THEN RAISE EXCEPTION 'task_not_found'; END IF;
    UPDATE public.follow_up_tasks
       SET title = _title, body = _body, priority = _priority,
           assignee_id = _assignee_id, due_at = _due_at,
           application_id = _application_id, job_id = _job_id,
           task_type = _task_type,
           due_notified_at = CASE WHEN due_at IS DISTINCT FROM _due_at
                                  THEN NULL ELSE due_notified_at END,
           updated_at = now()
     WHERE id = _task_id;
  ELSE
    INSERT INTO public.follow_up_tasks
      (company_id, job_id, application_id, candidate_id, assignee_id, title,
       body, priority, due_at, source, created_by, task_type)
    VALUES
      (_company_id, _job_id, _application_id, _candidate_id, _assignee_id,
       _title, _body, _priority, _due_at, 'manual', _actor, _task_type)
    RETURNING id INTO _new_id;
    PERFORM public.log_employer_activity(
      _company_id, _actor, 'crm_task_created', 'Follow-up scheduled',
      _title, '/employer/crm',
      jsonb_build_object('task_id', _new_id, 'candidate_id', _candidate_id,
                         'due_at', _due_at));
  END IF;
  RETURN _new_id;
END; $$;
REVOKE ALL ON FUNCTION public.crm_save_task(uuid, uuid, text, timestamptz, uuid, uuid, uuid, text, integer, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_save_task(uuid, uuid, text, timestamptz, uuid, uuid, uuid, text, integer, uuid, uuid, text) TO authenticated;
