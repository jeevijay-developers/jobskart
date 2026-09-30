-- ============================================================
-- Interview prep, part 2: question preferences (save / hide), category-focused
-- practice, and opt-in in-app practice reminders.
-- ============================================================

-- 1) Per-candidate question preferences -------------------------------------
CREATE TABLE IF NOT EXISTS public.interview_prep_question_prefs (
  candidate_id uuid NOT NULL,
  template_id uuid NOT NULL REFERENCES public.interview_prep_question_templates(id) ON DELETE CASCADE,
  pref text NOT NULL CHECK (pref IN ('saved','hidden')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (candidate_id, template_id)
);
ALTER TABLE public.interview_prep_question_prefs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.interview_prep_question_prefs TO authenticated;
GRANT UPDATE (pref) ON public.interview_prep_question_prefs TO authenticated;
GRANT ALL ON public.interview_prep_question_prefs TO service_role;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='interview_prep_question_prefs' AND policyname='owner select prefs') THEN
    CREATE POLICY "owner select prefs" ON public.interview_prep_question_prefs
      FOR SELECT TO authenticated USING (candidate_id = auth.uid());
    CREATE POLICY "owner insert prefs" ON public.interview_prep_question_prefs
      FOR INSERT TO authenticated WITH CHECK (candidate_id = auth.uid());
    CREATE POLICY "owner update prefs" ON public.interview_prep_question_prefs
      FOR UPDATE TO authenticated USING (candidate_id = auth.uid()) WITH CHECK (candidate_id = auth.uid());
    CREATE POLICY "owner delete prefs" ON public.interview_prep_question_prefs
      FOR DELETE TO authenticated USING (candidate_id = auth.uid());
  END IF;
END $$;

-- 2) start_interview_prep_session: + category focus, hidden/saved awareness ---
-- Signature changes, so drop the old overload (otherwise 5-arg calls become ambiguous).
DROP FUNCTION IF EXISTS public.start_interview_prep_session(text, uuid, uuid, text, int);

CREATE OR REPLACE FUNCTION public.start_interview_prep_session(
  _context_type text,
  _job_id uuid DEFAULT NULL,
  _interview_id uuid DEFAULT NULL,
  _role_title text DEFAULT NULL,
  _question_count int DEFAULT 6,
  _categories text[] DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _n int := LEAST(GREATEST(COALESCE(_question_count, 6), 3), 10);
  _job public.jobs%ROWTYPE;
  _iv public.interviews%ROWTYPE;
  _title text;
  _company text;
  _ctx jsonb := '{}'::jsonb;
  _skills text[] := '{}';
  _haystack text;
  _sid uuid;
  _picked int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _context_type NOT IN ('role','job','interview') THEN RAISE EXCEPTION 'invalid_context'; END IF;

  IF _context_type = 'interview' THEN
    SELECT * INTO _iv FROM public.interviews WHERE id = _interview_id AND candidate_id = _uid;
    IF NOT FOUND THEN RAISE EXCEPTION 'interview_not_found'; END IF;
    _job_id := _iv.job_id;
  END IF;

  IF _context_type IN ('job','interview') THEN
    IF _job_id IS NULL THEN RAISE EXCEPTION 'job_not_found'; END IF;
    SELECT * INTO _job FROM public.jobs WHERE id = _job_id;
    -- A plain job context requires a live public job; an interview context is the
    -- candidate's own and stays usable even after the job closes.
    IF NOT FOUND OR (_context_type = 'job' AND _job.status <> 'active') THEN
      RAISE EXCEPTION 'job_not_found';
    END IF;
    SELECT name INTO _company FROM public.companies WHERE id = _job.company_id;
    _title := _job.title;
    _skills := COALESCE(_job.skills, '{}');
    _ctx := jsonb_build_object(
      'title', _job.title, 'category', _job.category, 'skills', _skills,
      'company', _company, 'work_mode', _job.work_mode::text,
      'min_experience_years', _job.min_experience_years,
      'max_experience_years', _job.max_experience_years);
    IF _context_type = 'interview' THEN
      _ctx := _ctx || jsonb_build_object(
        'interview_mode', _iv.mode::text, 'scheduled_at', _iv.scheduled_at);
    END IF;
  ELSE
    _title := btrim(COALESCE(_role_title, ''));
    IF char_length(_title) < 2 OR char_length(_title) > 80 THEN RAISE EXCEPTION 'invalid_role'; END IF;
    _ctx := jsonb_build_object('title', _title, 'skills', '[]'::jsonb);
  END IF;

  _haystack := lower(_title || ' ' || COALESCE(_job.category, ''));

  PERFORM public.consume_interview_prep_quota('session');

  INSERT INTO public.interview_prep_sessions
    (candidate_id, context_type, job_id, interview_id, role_title, context)
  VALUES (_uid, _context_type, _job_id, _interview_id, _title, _ctx)
  RETURNING id INTO _sid;

  -- Balanced pick: best match per category first (role/skill relevant, then random),
  -- then fill remaining slots from the runners-up. Final order follows a natural
  -- interview arc (intro -> motivation -> role -> behavioural -> ... -> your questions).
  INSERT INTO public.interview_prep_session_questions
    (session_id, candidate_id, template_id, position, category, question_text, framework, rubric_version)
  SELECT _sid, _uid, p.id,
         row_number() OVER (ORDER BY p.cat_order, p.rn, p.rnd),
         p.category, p.question, p.framework, p.rubric_version
    FROM (
      SELECT x.*
        FROM (
          SELECT t.*,
                 CASE t.category WHEN 'intro' THEN 1 WHEN 'motivation' THEN 2 WHEN 'role_skill' THEN 3
                      WHEN 'behavioural' THEN 4 WHEN 'situational' THEN 5 WHEN 'logistics' THEN 6 ELSE 7 END AS cat_order,
                 random() AS rnd,
                 row_number() OVER (PARTITION BY t.category ORDER BY
                   ((EXISTS (SELECT 1 FROM public.interview_prep_question_prefs pr
                              WHERE pr.candidate_id = _uid AND pr.template_id = t.id AND pr.pref = 'saved'))::int * 3
                    + (t.role_keywords IS NOT NULL)::int * 2 + (t.skill_tags && _skills)::int) DESC, random()) AS rn
            FROM public.interview_prep_question_templates t
           WHERE t.status = 'published'
             AND (_categories IS NULL OR t.category = ANY(_categories))
             -- questions the candidate chose "don't ask again" on
             AND NOT EXISTS (SELECT 1 FROM public.interview_prep_question_prefs pr
                              WHERE pr.candidate_id = _uid AND pr.template_id = t.id AND pr.pref = 'hidden')
             -- role-specific questions only when the role actually matches
             AND (t.role_keywords IS NULL OR EXISTS (
                    SELECT 1 FROM unnest(t.role_keywords) k WHERE _haystack LIKE '%' || lower(k) || '%'))
        ) x
       ORDER BY x.rn, x.cat_order
       LIMIT _n
    ) p;

  GET DIAGNOSTICS _picked = ROW_COUNT;
  IF _picked = 0 THEN RAISE EXCEPTION 'no_questions'; END IF;

  RETURN _sid;
END $$;
REVOKE ALL ON FUNCTION public.start_interview_prep_session(text, uuid, uuid, text, int, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_interview_prep_session(text, uuid, uuid, text, int, text[]) TO authenticated, service_role;

-- 3) Practice reminders (in-app only, opt-in) ---------------------------------
-- Sent by a daily job, never by the client. Frequency caps: at most one reminder
-- per interview ever, at most one per candidate per day, none if they've already
-- practised for that interview, and only for candidates who switched them on
-- (candidate_profiles.notification_prefs.interview_prep_reminders = true).
CREATE TABLE IF NOT EXISTS public.interview_prep_reminders_sent (
  interview_id uuid PRIMARY KEY REFERENCES public.interviews(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ip_reminders_candidate ON public.interview_prep_reminders_sent (candidate_id, sent_at DESC);
ALTER TABLE public.interview_prep_reminders_sent ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.interview_prep_reminders_sent TO service_role;   -- no client access

CREATE OR REPLACE FUNCTION public.send_interview_prep_reminders()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n int := 0;
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (i.candidate_id) i.id AS interview_id, i.candidate_id, i.scheduled_at,
           COALESCE(j.title, 'your interview') AS title
      FROM public.interviews i
      JOIN public.candidate_profiles cp ON cp.user_id = i.candidate_id
      LEFT JOIN public.jobs j ON j.id = i.job_id
     WHERE i.status IN ('scheduled','confirmed','rescheduled')
       AND i.scheduled_at > now() + interval '3 hours'
       AND i.scheduled_at <= now() + interval '3 days'
       AND COALESCE((cp.notification_prefs ->> 'interview_prep_reminders')::boolean, false)
       AND NOT EXISTS (SELECT 1 FROM public.interview_prep_reminders_sent s WHERE s.interview_id = i.id)
       AND NOT EXISTS (SELECT 1 FROM public.interview_prep_reminders_sent s
                        WHERE s.candidate_id = i.candidate_id AND s.sent_at > now() - interval '1 day')
       AND NOT EXISTS (SELECT 1 FROM public.interview_prep_sessions ps
                        WHERE ps.candidate_id = i.candidate_id AND ps.interview_id = i.id)
     ORDER BY i.candidate_id, i.scheduled_at
  LOOP
    INSERT INTO public.interview_prep_reminders_sent (interview_id, candidate_id)
    VALUES (r.interview_id, r.candidate_id) ON CONFLICT DO NOTHING;
    IF FOUND THEN
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (r.candidate_id, 'interview_prep.reminder',
              'Practise for your interview',
              'A 10-minute private practice for ' || r.title || ' on ' || to_char(r.scheduled_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon, HH12:MI AM') || '.',
              '/candidate/interview-prep');
      _n := _n + 1;
    END IF;
  END LOOP;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.send_interview_prep_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_interview_prep_reminders() TO service_role;

-- 09:00 IST daily. cron.schedule() upserts by job name, so this stays re-runnable.
SELECT cron.schedule('interview-prep-reminders', '30 3 * * *', $cron$SELECT public.send_interview_prep_reminders();$cron$);
