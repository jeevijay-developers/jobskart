-- ============================================================
-- AI Interview Preparation (Phase 1: typed practice, MVP)
-- Candidate-owned, private. Employers get NO access to any table here.
-- See ai-interview-preparation-implementation-plan.md
-- ============================================================

-- 1) Curated question bank (AI-independent; staff-managed) ----------------
CREATE TABLE IF NOT EXISTS public.interview_prep_question_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL CHECK (category IN
    ('intro','motivation','role_skill','behavioural','situational','logistics','ask_employer')),
  question text NOT NULL,
  role_keywords text[],                       -- NULL = generic; else matched against job title/category
  skill_tags text[] NOT NULL DEFAULT '{}',
  difficulty text NOT NULL DEFAULT 'easy' CHECK (difficulty IN ('easy','medium','hard')),
  framework jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { name, steps[] } — an outline, never a "perfect answer"
  rubric_version int NOT NULL DEFAULT 1,
  language text NOT NULL DEFAULT 'en',
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','retired')),
  created_by uuid,
  reviewed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ip_templates_question
  ON public.interview_prep_question_templates (lower(question));
CREATE INDEX IF NOT EXISTS idx_ip_templates_status_category
  ON public.interview_prep_question_templates (status, category);

ALTER TABLE public.interview_prep_question_templates ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.interview_prep_question_templates TO authenticated;
GRANT ALL ON public.interview_prep_question_templates TO service_role;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='interview_prep_question_templates' AND policyname='read published templates') THEN
    CREATE POLICY "read published templates" ON public.interview_prep_question_templates
      FOR SELECT TO authenticated USING (status = 'published');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='interview_prep_question_templates' AND policyname='admins manage templates') THEN
    CREATE POLICY "admins manage templates" ON public.interview_prep_question_templates
      FOR ALL TO authenticated
      USING (public.has_platform_role(auth.uid(),'super_admin'))
      WITH CHECK (public.has_platform_role(auth.uid(),'super_admin'));
  END IF;
END $$;
GRANT INSERT, UPDATE, DELETE ON public.interview_prep_question_templates TO authenticated; -- gated by policy above

DROP TRIGGER IF EXISTS trg_ip_templates_updated ON public.interview_prep_question_templates;
CREATE TRIGGER trg_ip_templates_updated BEFORE UPDATE ON public.interview_prep_question_templates
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 2) Sessions --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.interview_prep_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL,
  context_type text NOT NULL CHECK (context_type IN ('role','job','interview')),
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  interview_id uuid REFERENCES public.interviews(id) ON DELETE SET NULL,
  role_title text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,     -- snapshot taken at start (job facts only; no employer-private data)
  mode text NOT NULL DEFAULT 'text' CHECK (mode IN ('text')),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  self_check smallint CHECK (self_check BETWEEN 1 AND 5),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_ip_sessions_candidate ON public.interview_prep_sessions (candidate_id, started_at DESC);

ALTER TABLE public.interview_prep_sessions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, DELETE ON public.interview_prep_sessions TO authenticated;
GRANT UPDATE (status, finished_at, self_check) ON public.interview_prep_sessions TO authenticated;
GRANT ALL ON public.interview_prep_sessions TO service_role;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='interview_prep_sessions' AND policyname='owner select sessions') THEN
    CREATE POLICY "owner select sessions" ON public.interview_prep_sessions
      FOR SELECT TO authenticated USING (candidate_id = auth.uid());
    CREATE POLICY "owner update sessions" ON public.interview_prep_sessions
      FOR UPDATE TO authenticated USING (candidate_id = auth.uid()) WITH CHECK (candidate_id = auth.uid());
    CREATE POLICY "owner delete sessions" ON public.interview_prep_sessions
      FOR DELETE TO authenticated USING (candidate_id = auth.uid());
  END IF;
END $$;

-- 3) Session questions (snapshotted so later template edits never rewrite history)
CREATE TABLE IF NOT EXISTS public.interview_prep_session_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.interview_prep_sessions(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL,
  template_id uuid REFERENCES public.interview_prep_question_templates(id) ON DELETE SET NULL,
  position int NOT NULL,
  category text NOT NULL,
  question_text text NOT NULL,
  framework jsonb NOT NULL DEFAULT '{}'::jsonb,
  rubric_version int NOT NULL DEFAULT 1,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','answered','skipped')),
  UNIQUE (session_id, position)
);
CREATE INDEX IF NOT EXISTS idx_ip_sq_candidate ON public.interview_prep_session_questions (candidate_id);

ALTER TABLE public.interview_prep_session_questions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.interview_prep_session_questions TO authenticated;
GRANT UPDATE (state) ON public.interview_prep_session_questions TO authenticated;
GRANT ALL ON public.interview_prep_session_questions TO service_role;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='interview_prep_session_questions' AND policyname='owner select session questions') THEN
    CREATE POLICY "owner select session questions" ON public.interview_prep_session_questions
      FOR SELECT TO authenticated USING (candidate_id = auth.uid());
    CREATE POLICY "owner update session questions" ON public.interview_prep_session_questions
      FOR UPDATE TO authenticated USING (candidate_id = auth.uid()) WITH CHECK (candidate_id = auth.uid());
  END IF;
END $$;

-- 4) Answers + structured feedback ----------------------------------------
CREATE TABLE IF NOT EXISTS public.interview_prep_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_question_id uuid NOT NULL REFERENCES public.interview_prep_session_questions(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL,
  attempt int NOT NULL DEFAULT 1,
  answer_text text NOT NULL CHECK (char_length(answer_text) BETWEEN 1 AND 4000),
  source text NOT NULL DEFAULT 'typed' CHECK (source IN ('typed')),
  feedback jsonb,
  feedback_source text CHECK (feedback_source IN ('ai','fallback')),
  rubric_version int,
  prompt_version text,
  model_info text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_question_id, attempt)
);
CREATE INDEX IF NOT EXISTS idx_ip_answers_candidate ON public.interview_prep_answers (candidate_id, created_at DESC);

ALTER TABLE public.interview_prep_answers ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.interview_prep_answers TO authenticated;
GRANT ALL ON public.interview_prep_answers TO service_role;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='interview_prep_answers' AND policyname='owner select answers') THEN
    CREATE POLICY "owner select answers" ON public.interview_prep_answers
      FOR SELECT TO authenticated USING (candidate_id = auth.uid());
    CREATE POLICY "owner insert answers" ON public.interview_prep_answers
      FOR INSERT TO authenticated WITH CHECK (
        candidate_id = auth.uid()
        AND EXISTS (SELECT 1 FROM public.interview_prep_session_questions q
                    WHERE q.id = session_question_id AND q.candidate_id = auth.uid()));
    CREATE POLICY "owner delete answers" ON public.interview_prep_answers
      FOR DELETE TO authenticated USING (candidate_id = auth.uid());
  END IF;
END $$;

-- 5) Usage ledger (quota + cost audit). Written only by RPCs. ---------------
CREATE TABLE IF NOT EXISTS public.interview_prep_usage_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('session','feedback')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ip_usage_candidate_kind
  ON public.interview_prep_usage_ledger (candidate_id, kind, created_at DESC);
ALTER TABLE public.interview_prep_usage_ledger ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.interview_prep_usage_ledger TO authenticated;
GRANT ALL ON public.interview_prep_usage_ledger TO service_role;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='interview_prep_usage_ledger' AND policyname='owner select usage') THEN
    CREATE POLICY "owner select usage" ON public.interview_prep_usage_ledger
      FOR SELECT TO authenticated USING (candidate_id = auth.uid());
  END IF;
END $$;

-- 6) Reports (question / feedback quality + safety) ------------------------
CREATE TABLE IF NOT EXISTS public.interview_prep_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('question','feedback')),
  session_question_id uuid REFERENCES public.interview_prep_session_questions(id) ON DELETE SET NULL,
  answer_id uuid REFERENCES public.interview_prep_answers(id) ON DELETE SET NULL,
  template_id uuid REFERENCES public.interview_prep_question_templates(id) ON DELETE SET NULL,
  category text NOT NULL CHECK (category IN ('inaccurate','irrelevant','unsafe','other')),
  details text CHECK (details IS NULL OR char_length(details) <= 1000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.interview_prep_reports ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.interview_prep_reports TO authenticated;
GRANT UPDATE (status) ON public.interview_prep_reports TO authenticated; -- gated to staff by policy
GRANT ALL ON public.interview_prep_reports TO service_role;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='interview_prep_reports' AND policyname='owner insert reports') THEN
    CREATE POLICY "owner insert reports" ON public.interview_prep_reports
      FOR INSERT TO authenticated WITH CHECK (reporter_id = auth.uid());
    CREATE POLICY "owner or admin select reports" ON public.interview_prep_reports
      FOR SELECT TO authenticated USING (
        reporter_id = auth.uid() OR public.has_platform_role(auth.uid(),'super_admin'));
    CREATE POLICY "admin update reports" ON public.interview_prep_reports
      FOR UPDATE TO authenticated
      USING (public.has_platform_role(auth.uid(),'super_admin'))
      WITH CHECK (public.has_platform_role(auth.uid(),'super_admin'));
  END IF;
END $$;

-- 7) RPC: consume quota (row/advisory-locked so two tabs can't overspend) ---
CREATE OR REPLACE FUNCTION public.consume_interview_prep_quota(_kind text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _limit int;
  _used int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _kind NOT IN ('session','feedback') THEN RAISE EXCEPTION 'invalid_kind'; END IF;
  _limit := CASE _kind WHEN 'session' THEN 10 ELSE 40 END;   -- per rolling 24h

  PERFORM pg_advisory_xact_lock(hashtextextended(_uid::text || ':ip:' || _kind, 0));

  SELECT count(*) INTO _used FROM public.interview_prep_usage_ledger
   WHERE candidate_id = _uid AND kind = _kind AND created_at > now() - interval '24 hours';
  IF _used >= _limit THEN RAISE EXCEPTION 'quota_exceeded'; END IF;

  INSERT INTO public.interview_prep_usage_ledger (candidate_id, kind) VALUES (_uid, _kind);
END $$;
REVOKE ALL ON FUNCTION public.consume_interview_prep_quota(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_interview_prep_quota(text) TO authenticated, service_role;

-- 8) RPC: start a session --------------------------------------------------
-- Resolves context server-side (ownership checked here, never trusting the client),
-- snapshots job facts, and picks a balanced, non-duplicated question set.
CREATE OR REPLACE FUNCTION public.start_interview_prep_session(
  _context_type text,
  _job_id uuid DEFAULT NULL,
  _interview_id uuid DEFAULT NULL,
  _role_title text DEFAULT NULL,
  _question_count int DEFAULT 6
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
                   ((t.role_keywords IS NOT NULL)::int * 2 + (t.skill_tags && _skills)::int) DESC, random()) AS rn
            FROM public.interview_prep_question_templates t
           WHERE t.status = 'published'
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
REVOKE ALL ON FUNCTION public.start_interview_prep_session(text, uuid, uuid, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_interview_prep_session(text, uuid, uuid, text, int) TO authenticated, service_role;

-- 9) Seed: reviewed starter question bank ----------------------------------
-- (idempotent: skipped when the question text already exists)
WITH seed(category, question, role_keywords, skill_tags, difficulty, framework) AS (
  VALUES
  ('intro','Tell me about yourself.',NULL::text[],'{}'::text[],'easy','{"name":"Present-Past-Future","steps":["Who you are now (current role or situation)","Relevant experience so far","Why this role next"]}'::jsonb),
  ('intro','Walk me through your work experience so far.',NULL,'{}','easy','{"name":"Timeline","steps":["Start with your most recent role","One key responsibility or result per role","Connect it to this job"]}'::jsonb),
  ('intro','What are your strengths that suit this job?',NULL,'{}','easy','{"name":"Claim-Proof","steps":["Name 1-2 strengths","Give a real example for each","Link them to the job"]}'::jsonb),
  ('motivation','Why do you want to work in this role?',NULL,'{}','easy','{"name":"Motivation","steps":["What attracts you to the work itself","What you can contribute","Where you want to grow"]}'::jsonb),
  ('motivation','Why do you want to join our company?',NULL,'{}','medium','{"name":"Research-Fit","steps":["One thing you learned about the company","Why it matters to you","How your skills fit"]}'::jsonb),
  ('motivation','Where do you see yourself in the next two to three years?',NULL,'{}','medium','{"name":"Growth","steps":["Skills you want to build","How this role helps","Commitment to the work"]}'::jsonb),
  ('motivation','Why did you leave your last job, or why are you looking for a change?',NULL,'{}','medium','{"name":"Positive-Forward","steps":["A brief, honest reason","Stay constructive about past employers","Pivot to what you want next"]}'::jsonb),
  ('behavioural','Tell me about a time you handled a difficult customer or colleague.',NULL,'{}','medium','{"name":"STAR","steps":["Situation","Task","Action","Result"]}'::jsonb),
  ('behavioural','Describe a time you worked under pressure to meet a deadline.',NULL,'{}','medium','{"name":"STAR","steps":["Situation","Task","Action","Result"]}'::jsonb),
  ('behavioural','Tell me about a mistake you made at work and what you did about it.',NULL,'{}','medium','{"name":"STAR","steps":["Situation","Task","Action","Result / what you learned"]}'::jsonb),
  ('behavioural','Give an example of when you worked well as part of a team.',NULL,'{}','easy','{"name":"STAR","steps":["Situation","Your role","Action","Result"]}'::jsonb),
  ('behavioural','Tell me about a time you learned a new skill quickly.',NULL,'{}','medium','{"name":"STAR","steps":["Situation","What you had to learn","How you learned it","Result"]}'::jsonb),
  ('situational','What would you do if you did not know the answer to something a customer asked?',NULL,'{}','easy','{"name":"Approach","steps":["Stay calm and be honest","Find the right answer or person","Follow up with the customer"]}'::jsonb),
  ('situational','If you had two urgent tasks at the same time, how would you decide what to do first?',NULL,'{}','medium','{"name":"Prioritise","steps":["Clarify urgency and impact","Communicate with your manager or team","Do, then report back"]}'::jsonb),
  ('situational','What would you do if a colleague was not doing their share of the work?',NULL,'{}','hard','{"name":"Approach","steps":["Understand the situation first","Talk to the colleague directly","Escalate only if needed"]}'::jsonb),
  ('logistics','Are you comfortable with the shift timing and work location for this job?',NULL,'{}','easy','{"name":"Clear-Answer","steps":["Answer yes/no plainly","Mention any real constraint honestly","Offer a workable option"]}'::jsonb),
  ('logistics','What is your expected salary, and how flexible are you?',NULL,'{}','medium','{"name":"Range","steps":["State a realistic range","Base it on skills and market","Show flexibility on the total package"]}'::jsonb),
  ('logistics','When can you join, and what is your notice period?',NULL,'{}','easy','{"name":"Clear-Answer","steps":["Give the actual date or notice period","Mention if it is negotiable","Confirm your interest"]}'::jsonb),
  ('ask_employer','What questions do you have for us?',NULL,'{}','easy','{"name":"Good-Questions","steps":["Ask about the role and daily work","Ask about training or growth","Ask about next steps"]}'::jsonb),
  -- role-specific
  ('role_skill','How do you handle an angry or upset customer on a call?',ARRAY['customer','support','bpo','call','telecall','voice'],ARRAY['Communication','Customer Service'],'medium','{"name":"LAST","steps":["Listen","Apologise / acknowledge","Solve","Thank and confirm"]}'::jsonb),
  ('role_skill','How do you keep your energy and quality up when taking many calls in a row?',ARRAY['customer','support','bpo','call','telecall','voice'],ARRAY['Communication'],'easy','{"name":"Routine","steps":["Your routine or habits","How you keep quality consistent","An example"]}'::jsonb),
  ('role_skill','How would you convince a customer who says the price is too high?',ARRAY['sales','marketing','business development','executive','retail'],ARRAY['Sales','Negotiation'],'medium','{"name":"Value-Selling","steps":["Understand their need","Explain the value, not just the price","Offer options and close"]}'::jsonb),
  ('role_skill','Tell me how you have achieved, or would achieve, a sales target.',ARRAY['sales','marketing','business development','executive','retail'],ARRAY['Sales'],'medium','{"name":"Target-Plan","steps":["The target","Your daily activity and follow-up","The result or expected result"]}'::jsonb),
  ('role_skill','How do you make sure deliveries reach the right person on time?',ARRAY['delivery','driver','courier','rider','logistics'],ARRAY['Delivery','Route Planning'],'easy','{"name":"Process","steps":["Plan the route","Verify address and contact","Handle delays and confirm delivery"]}'::jsonb),
  ('role_skill','What do you do if a customer is not available at the delivery address?',ARRAY['delivery','driver','courier','rider','logistics'],ARRAY['Delivery'],'easy','{"name":"Approach","steps":["Try to contact them","Follow company procedure","Record the outcome"]}'::jsonb),
  ('role_skill','How do you keep stock accurate and organised in a warehouse?',ARRAY['warehouse','store','inventory','stock','picker','packer'],ARRAY['Inventory Management'],'medium','{"name":"Process","steps":["Receiving and checking","Storing and labelling","Regular counts and reporting differences"]}'::jsonb),
  ('role_skill','How do you follow safety rules while lifting and moving goods?',ARRAY['warehouse','store','inventory','stock','picker','packer','helper','loader'],ARRAY['Safety'],'easy','{"name":"Safety-First","steps":["Rules you follow","Equipment you use","What you do when something looks unsafe"]}'::jsonb),
  ('role_skill','How do you handle cash and billing accurately at the counter?',ARRAY['cashier','billing','retail','counter','store'],ARRAY['Billing','Cash Handling'],'easy','{"name":"Process","steps":["Verify items and amounts","Count and confirm change","Reconcile at end of shift"]}'::jsonb),
  ('role_skill','How do you approach a customer who walks into the store and looks undecided?',ARRAY['retail','sales','store','showroom','counter'],ARRAY['Customer Service','Sales'],'easy','{"name":"Approach","steps":["Greet and ask open questions","Recommend based on need","Help them decide without pressure"]}'::jsonb),
  ('role_skill','What steps do you follow to keep food and the kitchen hygienic?',ARRAY['cook','chef','kitchen','restaurant','hotel','waiter','steward'],ARRAY['Hygiene'],'easy','{"name":"Process","steps":["Personal hygiene","Handling and storage","Cleaning routine"]}'::jsonb),
  ('role_skill','How do you make sure a machine or vehicle is safe to use before starting work?',ARRAY['operator','technician','mechanic','driver','electrician','fitter','machine'],ARRAY['Safety','Maintenance'],'medium','{"name":"Checklist","steps":["Pre-use checks","What you do if something is wrong","Reporting and records"]}'::jsonb),
  ('role_skill','Describe how you would handle a security incident during your shift.',ARRAY['security','guard','supervisor'],ARRAY['Security'],'medium','{"name":"Approach","steps":["Assess safety first","Follow the procedure and inform your supervisor","Document what happened"]}'::jsonb)
)
INSERT INTO public.interview_prep_question_templates
  (category, question, role_keywords, skill_tags, difficulty, framework)
SELECT s.category, s.question, s.role_keywords, s.skill_tags, s.difficulty, s.framework
  FROM seed s
 WHERE NOT EXISTS (
   SELECT 1 FROM public.interview_prep_question_templates t WHERE lower(t.question) = lower(s.question));
