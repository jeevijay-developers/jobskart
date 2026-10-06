-- Candidate confirmation email on successful apply.
--
-- Extends tg_applications_after_insert() (last defined in
-- 20260630002107_42eb8531-a932-41c7-a5d0-1822a6af0b79.sql) with a pg_net call
-- to the application-received-notify Edge Function. Body below is the previous
-- trigger body verbatim; the only addition is the guarded net.http_post block.
--
-- Why in the DB and not the browser: the trigger fires for every insert path
-- (ApplyDialog.tsx and invite_candidate_to_apply), and the email is queued even
-- if the candidate closes the tab right after submitting.
--
-- The HTTP call is wrapped in its own exception block so a missing vault secret,
-- pg_net outage, or bad URL can never roll back the application insert
-- (rule 7: no third-party failure blocks a core flow).

-- pg_net is already enabled by 20260914075503_alert_job_notifications.sql;
-- repeated here so this migration stands on its own.
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.tg_applications_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _job_title text; _cand_name text;
BEGIN
  UPDATE public.jobs SET applications_count = applications_count + 1 WHERE id = NEW.job_id;
  INSERT INTO public.application_status_history(application_id, from_status, to_status, changed_by)
    VALUES (NEW.id, NULL, NEW.status, NEW.candidate_id);
  SELECT title INTO _job_title FROM public.jobs WHERE id = NEW.job_id;
  SELECT full_name INTO _cand_name FROM public.profiles WHERE id = NEW.candidate_id;
  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT em.user_id, 'application.new',
         'New application',
         'A candidate applied to "' || _job_title || '"',
         '/employer/jobs/' || NEW.job_id::text || '/applicants'
  FROM public.employer_members em WHERE em.company_id = NEW.company_id;
  PERFORM public.log_employer_activity(
    NEW.company_id, NEW.candidate_id, 'application.received',
    'New application',
    COALESCE(_cand_name, 'A candidate') || ' applied to "' || COALESCE(_job_title,'job') || '"',
    '/employer/jobs/' || NEW.job_id::text || '/applicants',
    jsonb_build_object('application_id', NEW.id, 'job_id', NEW.job_id, 'candidate_id', NEW.candidate_id)
  );

  -- Candidate confirmation email (async; failure must not block the insert).
  BEGIN
    PERFORM net.http_post(
      url := 'https://swdntxurukbkyksuyzhg.functions.supabase.co/application-received-notify',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
      ),
      body := jsonb_build_object('applicationId', NEW.id)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'application-received-notify enqueue failed for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END $$;
