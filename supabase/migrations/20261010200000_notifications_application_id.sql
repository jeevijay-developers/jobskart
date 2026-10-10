-- ============================================================
-- Point 16 follow-up: notifications.application_id, so
-- "Application status updated" / "Interview scheduled" can deep-link to the
-- exact application (Applications page, highlighted + scrolled card) the
-- same way "candidate.invited_to_apply" already deep-links to a job.
--
-- Nullable, additive. Everything else in tg_applications_after_update() and
-- tg_interviews_notify() (titles, bodies, links, the application.viewed /
-- employer-activity inserts, conditions) is copied verbatim from their
-- current definitions — 20260630002107_... and 20260714063327_... — only
-- the notifications INSERT's column list gains application_id.
-- ============================================================

-- 1) Column + index
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS application_id uuid REFERENCES public.applications(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_application_id
  ON public.notifications(application_id) WHERE application_id IS NOT NULL;
-- No RLS change needed: "Users read own notifications" (USING user_id =
-- auth.uid()) is a row filter, not a column list — it already covers any
-- column on the table, this new one included.

-- 2) tg_applications_after_update(): NEW.id is the application's own id —
-- pass it straight through, same transaction as the status-history insert.
CREATE OR REPLACE FUNCTION public.tg_applications_after_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _job_title text; _cand_name text;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.application_status_history(application_id, from_status, to_status, changed_by)
      VALUES (NEW.id, OLD.status, NEW.status, auth.uid());
    INSERT INTO public.notifications (user_id, type, title, body, link, application_id)
    SELECT NEW.candidate_id, 'application.status',
           'Application status updated',
           'Your application is now: ' || NEW.status,
           '/candidate/applications',
           NEW.id;
    SELECT title INTO _job_title FROM public.jobs WHERE id = NEW.job_id;
    SELECT full_name INTO _cand_name FROM public.profiles WHERE id = NEW.candidate_id;
    PERFORM public.log_employer_activity(
      NEW.company_id, auth.uid(), 'application.status_changed',
      'Application moved to ' || NEW.status,
      COALESCE(_cand_name,'Candidate') || ' on "' || COALESCE(_job_title,'job') || '"',
      '/employer/jobs/' || NEW.job_id::text || '/applicants',
      jsonb_build_object('application_id', NEW.id, 'from', OLD.status, 'to', NEW.status)
    );
  END IF;
  RETURN NEW;
END $$;

-- 3) tg_interviews_notify(): interviews already has application_id (used
-- below, line "jsonb_build_object('interview_id', ...)") — pass it through
-- to the candidate-facing notification row too.
CREATE OR REPLACE FUNCTION public.tg_interviews_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _job_title text;
BEGIN
  SELECT title INTO _job_title FROM public.jobs WHERE id = NEW.job_id;
  INSERT INTO public.notifications (user_id, type, title, body, link, application_id)
  VALUES (NEW.candidate_id, 'interview.scheduled',
          'Interview scheduled',
          COALESCE(_job_title,'A role') || ' · ' || to_char(NEW.scheduled_at, 'DD Mon, HH24:MI'),
          '/candidate/interviews',
          NEW.application_id);
  PERFORM public.log_employer_activity(
    NEW.company_id, NEW.created_by, 'interview.scheduled',
    'Interview scheduled', COALESCE(_job_title,'') || ' · ' || to_char(NEW.scheduled_at, 'DD Mon, HH24:MI'),
    '/employer/interviews',
    jsonb_build_object('interview_id', NEW.id, 'application_id', NEW.application_id));
  RETURN NEW;
END $$;
-- (trg_interviews_notify / trg_applications_after_update triggers already
-- exist and point at these functions by name — CREATE OR REPLACE swaps the
-- body in place, no trigger needs recreating.)

-- 4) Best-effort backfill of existing rows, only where the match is unique
-- and unambiguous. Verified against the live data before writing this
-- (read-only check, not guessed): every 'application.status' row matches at
-- most one application_status_history row on (same candidate, same
-- to_status text as the notification body, created within 2 seconds of each
-- other — both inserts happen in the same trigger call, so real matches are
-- effectively simultaneous); every 'interview.scheduled' row matches at most
-- one interviews row on (same candidate, created within 2 seconds). Rows
-- with zero or more than one match are left untouched (application_id stays
-- NULL) rather than guessed.
UPDATE public.notifications n
SET application_id = h.application_id
FROM (
  SELECT notification_id, application_id FROM (
    SELECT n2.id AS notification_id, ash.application_id,
           count(*) OVER (PARTITION BY n2.id) AS match_count
    FROM public.notifications n2
    JOIN public.application_status_history ash
      ON ash.to_status = replace(n2.body, 'Your application is now: ', '')
     AND ash.created_at BETWEEN n2.created_at - interval '2 seconds' AND n2.created_at + interval '2 seconds'
    JOIN public.applications a ON a.id = ash.application_id AND a.candidate_id = n2.user_id
    WHERE n2.type = 'application.status' AND n2.application_id IS NULL
  ) counted
  WHERE match_count = 1
) h
WHERE n.id = h.notification_id;

UPDATE public.notifications n
SET application_id = h.application_id
FROM (
  SELECT notification_id, application_id FROM (
    SELECT n2.id AS notification_id, iv.application_id,
           count(*) OVER (PARTITION BY n2.id) AS match_count
    FROM public.notifications n2
    JOIN public.interviews iv
      ON iv.candidate_id = n2.user_id
     AND iv.created_at BETWEEN n2.created_at - interval '2 seconds' AND n2.created_at + interval '2 seconds'
    WHERE n2.type = 'interview.scheduled' AND n2.application_id IS NULL
  ) counted
  WHERE match_count = 1
) h
WHERE n.id = h.notification_id;

NOTIFY pgrst, 'reload schema';

-- Rollback: ALTER TABLE public.notifications DROP COLUMN IF EXISTS application_id; then re-run 20260630002107_...'s and 20260714063327_...'s original CREATE OR REPLACE bodies for the two functions (without application_id).
