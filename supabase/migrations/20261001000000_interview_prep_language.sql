-- ============================================================
-- Interview prep, part 4: session-level language (English/Hindi).
-- Scope: content only (question text, feedback prose, TTS) — not full UI i18n.
-- Question *selection* logic (role_keywords/skill_tags matching) stays English-only;
-- only the *displayed* question text is localized, via an admin-reviewed
-- translations table. Runtime session-start stays AI-free, as it is today.
-- ============================================================

-- 1) Session-level language, locked at session start ------------------------
ALTER TABLE public.interview_prep_sessions
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en' CHECK (language IN ('en','hi'));

-- 2) Which language the feedback prose was actually generated in ------------
ALTER TABLE public.interview_prep_answers
  ADD COLUMN IF NOT EXISTS feedback_language text NOT NULL DEFAULT 'en' CHECK (feedback_language IN ('en','hi'));

-- 3) Admin-reviewed question translations ------------------------------------
-- English stays the base row in interview_prep_question_templates (the fallback);
-- this table only ever holds non-English overlays. Never shown to candidates
-- until status='published' — drafted via AI, reviewed/edited by a human first.
CREATE TABLE IF NOT EXISTS public.interview_prep_question_template_translations (
  template_id uuid NOT NULL REFERENCES public.interview_prep_question_templates(id) ON DELETE CASCADE,
  language text NOT NULL CHECK (language IN ('hi')),
  question text NOT NULL,
  framework jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  created_by uuid,
  reviewed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (template_id, language)
);
ALTER TABLE public.interview_prep_question_template_translations ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.interview_prep_question_template_translations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.interview_prep_question_template_translations TO authenticated;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='interview_prep_question_template_translations' AND policyname='admins manage template translations') THEN
    CREATE POLICY "admins manage template translations" ON public.interview_prep_question_template_translations
      FOR ALL TO authenticated
      USING (public.has_platform_role(auth.uid(),'super_admin'))
      WITH CHECK (public.has_platform_role(auth.uid(),'super_admin'));
  END IF;
END $$;
-- No candidate-facing SELECT policy: the RPC below (SECURITY DEFINER) is the only
-- reader at runtime, applied once when a session's questions are snapshotted —
-- candidates never query this table directly.

DROP TRIGGER IF EXISTS trg_ip_template_translations_updated ON public.interview_prep_question_template_translations;
CREATE TRIGGER trg_ip_template_translations_updated BEFORE UPDATE ON public.interview_prep_question_template_translations
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 4) start_interview_prep_session: + _language, overlaying published translations
-- Signature changes (new trailing param), so drop the old 6-arg overload first.
DROP FUNCTION IF EXISTS public.start_interview_prep_session(text, uuid, uuid, text, int, text[]);

CREATE OR REPLACE FUNCTION public.start_interview_prep_session(
  _context_type text,
  _job_id uuid DEFAULT NULL,
  _interview_id uuid DEFAULT NULL,
  _role_title text DEFAULT NULL,
  _question_count int DEFAULT 6,
  _categories text[] DEFAULT NULL,
  _language text DEFAULT 'en'
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
  IF _language NOT IN ('en','hi') THEN _language := 'en'; END IF;

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
    (candidate_id, context_type, job_id, interview_id, role_title, context, language)
  VALUES (_uid, _context_type, _job_id, _interview_id, _title, _ctx, _language)
  RETURNING id INTO _sid;

  -- Balanced pick: best match per category first (role/skill relevant, then random),
  -- then fill remaining slots from the runners-up. Final order follows a natural
  -- interview arc (intro -> motivation -> role -> behavioural -> ... -> your questions).
  -- Selection itself stays English-keyword-based regardless of _language; only the
  -- snapshotted question_text/framework are overlaid with a published translation
  -- when one exists — a template with none just snapshots in English, silently.
  INSERT INTO public.interview_prep_session_questions
    (session_id, candidate_id, template_id, position, category, question_text, framework, rubric_version)
  SELECT _sid, _uid, p.id,
         row_number() OVER (ORDER BY p.cat_order, p.rn, p.rnd),
         p.category,
         COALESCE(tr.question, p.question),
         COALESCE(tr.framework, p.framework),
         p.rubric_version
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
    ) p
    LEFT JOIN public.interview_prep_question_template_translations tr
      ON tr.template_id = p.id AND tr.language = _language AND tr.status = 'published';

  GET DIAGNOSTICS _picked = ROW_COUNT;
  IF _picked = 0 THEN RAISE EXCEPTION 'no_questions'; END IF;

  RETURN _sid;
END $$;
REVOKE ALL ON FUNCTION public.start_interview_prep_session(text, uuid, uuid, text, int, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_interview_prep_session(text, uuid, uuid, text, int, text[], text) TO authenticated, service_role;
