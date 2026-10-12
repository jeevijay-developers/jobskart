-- ============================================================
-- Interview Card: a candidate-curated, voice-first interview that the candidate
-- can choose to attach to a job application.
--
-- Deliberately SEPARATE from interview prep (practice stays private, audio never
-- stored). The card has its own consent, its own fixed question set, and its own
-- storage. Rules enforced here, not in React:
--   * one card per candidate (UNIQUE candidate_id) — re-recording replaces it
--   * transcripts / feedback / audio paths are written only by the server
--     (service role); candidates cannot forge them from the browser
--   * employers have no table access at all — only membership-checked RPCs, and
--     only while an unrevoked share exists for that application
--   * every employer view is logged to employer_activity and shown to the candidate
-- ============================================================

-- 1) Private audio bucket (no storage policies: only the server, via service role,
--    uploads and signs short-lived URLs) -------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('interview-cards', 'interview-cards', false, 3000000,
        ARRAY['audio/webm','audio/ogg','audio/mp4','audio/x-m4a','audio/mpeg','audio/wav','audio/x-wav'])
ON CONFLICT (id) DO NOTHING;

-- 2) Consent — separate from practice voice consent: it covers STORAGE and SHARING -
CREATE TABLE IF NOT EXISTS public.interview_card_consent (
  candidate_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  version int NOT NULL,
  consented_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.interview_card_consent ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.interview_card_consent TO service_role;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='interview_card_consent' AND policyname='owner select card consent') THEN
    CREATE POLICY "owner select card consent" ON public.interview_card_consent
      FOR SELECT TO authenticated USING (candidate_id = auth.uid());
    CREATE POLICY "owner insert card consent" ON public.interview_card_consent
      FOR INSERT TO authenticated WITH CHECK (candidate_id = auth.uid());
    CREATE POLICY "owner delete card consent" ON public.interview_card_consent
      FOR DELETE TO authenticated USING (candidate_id = auth.uid());
  END IF;
END $$;

-- 3) The card (one per candidate) ----------------------------------------------
CREATE TABLE IF NOT EXISTS public.interview_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  role_title text NOT NULL CHECK (char_length(role_title) BETWEEN 2 AND 80),
  language text NOT NULL DEFAULT 'en' CHECK (language IN ('en','hi')),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','published')),
  summary_band text CHECK (summary_band IN ('needs_work','developing','strong')),
  question_set_version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.interview_cards ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.interview_cards TO service_role;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='interview_cards' AND policyname='owner select cards') THEN
    CREATE POLICY "owner select cards" ON public.interview_cards
      FOR SELECT TO authenticated USING (candidate_id = auth.uid());
  END IF;
END $$;
DROP TRIGGER IF EXISTS trg_interview_cards_updated ON public.interview_cards;
CREATE TRIGGER trg_interview_cards_updated BEFORE UPDATE ON public.interview_cards
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 4) Card items: one row per question, snapshotted at start ---------------------
CREATE TABLE IF NOT EXISTS public.interview_card_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES public.interview_cards(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.interview_prep_question_templates(id) ON DELETE SET NULL,
  position int NOT NULL,
  category text NOT NULL,
  question_text text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','answered')),
  takes smallint NOT NULL DEFAULT 0 CHECK (takes BETWEEN 0 AND 2),   -- 1 retake allowed
  include boolean NOT NULL DEFAULT true,                              -- candidate's choice
  audio_path text,
  duration_sec int CHECK (duration_sec IS NULL OR duration_sec BETWEEN 1 AND 120),
  transcript text CHECK (transcript IS NULL OR char_length(transcript) <= 4000),
  voice_metrics jsonb,
  feedback jsonb,
  feedback_source text CHECK (feedback_source IN ('ai','fallback')),
  feedback_language text CHECK (feedback_language IN ('en','hi')),
  rubric_version int,
  prompt_version text,
  answered_at timestamptz,
  UNIQUE (card_id, position)
);
CREATE INDEX IF NOT EXISTS idx_icard_items_candidate ON public.interview_card_items (candidate_id);
ALTER TABLE public.interview_card_items ENABLE ROW LEVEL SECURITY;
-- Read-only for the owner. No INSERT/UPDATE grant: transcript, feedback and audio
-- path are server-authored, and `include` changes only via set_card_item_included().
GRANT ALL ON public.interview_card_items TO service_role;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='interview_card_items' AND policyname='owner select card items') THEN
    CREATE POLICY "owner select card items" ON public.interview_card_items
      FOR SELECT TO authenticated USING (candidate_id = auth.uid());
  END IF;
END $$;

-- 5) Per-application share (revocable). Employers never read this table. ---------
CREATE TABLE IF NOT EXISTS public.interview_card_shares (
  application_id uuid PRIMARY KEY REFERENCES public.applications(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES public.interview_cards(id) ON DELETE CASCADE,
  shared_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
ALTER TABLE public.interview_card_shares ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.interview_card_shares TO service_role;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='interview_card_shares' AND policyname='owner select card shares') THEN
    CREATE POLICY "owner select card shares" ON public.interview_card_shares
      FOR SELECT TO authenticated USING (candidate_id = auth.uid());
  END IF;
END $$;

-- 6) Employer views (so the candidate can see who looked) -------------------------
CREATE TABLE IF NOT EXISTS public.interview_card_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES public.interview_cards(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  viewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  viewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_icard_views_app ON public.interview_card_views (application_id, viewer_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_icard_views_candidate ON public.interview_card_views (candidate_id, viewed_at DESC);
ALTER TABLE public.interview_card_views ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.interview_card_views TO service_role;
-- No direct grants: the candidate reads via get_my_interview_card_views() (company + job only).

-- Supabase grants new public tables to anon/authenticated by default, so every grant below
-- starts from a REVOKE ALL: the absence of a GRANT alone would not stop a browser write.
REVOKE ALL ON public.interview_card_consent, public.interview_cards, public.interview_card_items,
  public.interview_card_shares, public.interview_card_views FROM anon, authenticated;

GRANT SELECT, INSERT, DELETE ON public.interview_card_consent TO authenticated;
GRANT SELECT ON public.interview_cards, public.interview_card_items, public.interview_card_shares TO authenticated;

-- 7) Helpers (internal) ---------------------------------------------------------
-- Mean band score of one answer's feedback criteria: needs_work 0, developing 1, strong 2.
CREATE OR REPLACE FUNCTION public._card_item_score(_fb jsonb)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT avg(CASE c->>'band' WHEN 'strong' THEN 2 WHEN 'developing' THEN 1 ELSE 0 END)
    FROM jsonb_array_elements(COALESCE(_fb->'criteria', '[]'::jsonb)) c
$$;

-- Overall band over the answers the candidate chose to include. NULL when none.
-- Thresholds mirror computeReadiness() in src/lib/interview-prep.ts.
CREATE OR REPLACE FUNCTION public._card_summary_band(_card_id uuid)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE WHEN m IS NULL THEN NULL
              WHEN m < 0.8 THEN 'needs_work'
              WHEN m < 1.4 THEN 'developing'
              ELSE 'strong' END
    FROM (SELECT avg(public._card_item_score(feedback)) AS m
            FROM public.interview_card_items
           WHERE card_id = _card_id AND state = 'answered' AND include AND feedback IS NOT NULL) s
$$;
REVOKE ALL ON FUNCTION public._card_item_score(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._card_summary_band(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._card_item_score(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public._card_summary_band(uuid) TO service_role;

-- 8) RPC: delete my card; returns audio paths so the server can purge storage -----
CREATE OR REPLACE FUNCTION public.delete_my_interview_card()
RETURNS text[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _paths text[];
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT COALESCE(array_agg(audio_path) FILTER (WHERE audio_path IS NOT NULL), '{}')
    INTO _paths FROM public.interview_card_items WHERE candidate_id = _uid;
  DELETE FROM public.interview_cards WHERE candidate_id = _uid;   -- cascades items, shares, views
  RETURN _paths;
END $$;
REVOKE ALL ON FUNCTION public.delete_my_interview_card() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_interview_card() TO authenticated, service_role;

-- 9) RPC: start a card. Fixed, deterministic question set per role so employers can
--    compare like with like (same role => same questions, no randomness). ----------
CREATE OR REPLACE FUNCTION public.start_interview_card(
  _role_title text,
  _language text DEFAULT 'en'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _title text := btrim(COALESCE(_role_title, ''));
  _haystack text;
  _cid uuid;
  _picked int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.interview_card_consent WHERE candidate_id = _uid AND version >= 1) THEN
    RAISE EXCEPTION 'consent_required';
  END IF;
  IF char_length(_title) < 2 OR char_length(_title) > 80 THEN RAISE EXCEPTION 'invalid_role'; END IF;
  IF _language NOT IN ('en','hi') THEN _language := 'en'; END IF;
  IF EXISTS (SELECT 1 FROM public.interview_cards WHERE candidate_id = _uid) THEN
    RAISE EXCEPTION 'card_exists';   -- caller must delete the old card (and its audio) first
  END IF;

  _haystack := lower(_title);

  INSERT INTO public.interview_cards (candidate_id, role_title, language)
  VALUES (_uid, _title, _language) RETURNING id INTO _cid;

  INSERT INTO public.interview_card_items
    (card_id, candidate_id, template_id, position, category, question_text)
  SELECT _cid, _uid, p.id, row_number() OVER (ORDER BY p.arc), p.category,
         COALESCE(tr.question, p.question)
    FROM (
      SELECT x.*
        FROM (
          SELECT t.*,
                 CASE t.category WHEN 'intro' THEN 1 WHEN 'motivation' THEN 2 WHEN 'role_skill' THEN 3
                      WHEN 'behavioural' THEN 4 WHEN 'situational' THEN 5 ELSE 6 END AS arc,
                 CASE t.category WHEN 'intro' THEN 1 WHEN 'motivation' THEN 2 WHEN 'role_skill' THEN 3
                      WHEN 'behavioural' THEN 4 WHEN 'logistics' THEN 5 ELSE 6 END AS prio,
                 row_number() OVER (PARTITION BY t.category
                                    ORDER BY (t.role_keywords IS NOT NULL) DESC, md5(t.id::text)) AS rn
            FROM public.interview_prep_question_templates t
           WHERE t.status = 'published'
             AND t.category IN ('intro','motivation','role_skill','behavioural','situational','logistics')
             AND (t.role_keywords IS NULL OR EXISTS (
                    SELECT 1 FROM unnest(t.role_keywords) k WHERE _haystack LIKE '%' || lower(k) || '%'))
        ) x
       WHERE x.rn = 1
       ORDER BY x.prio
       LIMIT 5
    ) p
    LEFT JOIN public.interview_prep_question_template_translations tr
      ON tr.template_id = p.id AND tr.language = _language AND tr.status = 'published';

  GET DIAGNOSTICS _picked = ROW_COUNT;
  IF _picked < 3 THEN RAISE EXCEPTION 'no_questions'; END IF;
  RETURN _cid;
END $$;
REVOKE ALL ON FUNCTION public.start_interview_card(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_interview_card(text, text) TO authenticated, service_role;

-- 10) RPC: choose which answers to include ----------------------------------------
CREATE OR REPLACE FUNCTION public.set_card_item_included(_item_id uuid, _include boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _card public.interview_cards%ROWTYPE;
  _left int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT c.* INTO _card FROM public.interview_cards c
    JOIN public.interview_card_items i ON i.card_id = c.id
   WHERE i.id = _item_id AND i.candidate_id = _uid AND i.state = 'answered';
  IF NOT FOUND THEN RAISE EXCEPTION 'item_not_found'; END IF;

  UPDATE public.interview_card_items SET include = _include WHERE id = _item_id;

  IF _card.status = 'published' THEN
    SELECT count(*) INTO _left FROM public.interview_card_items
     WHERE card_id = _card.id AND state = 'answered' AND include;
    IF _left < 3 THEN RAISE EXCEPTION 'min_included'; END IF;     -- rolls the UPDATE back
    UPDATE public.interview_cards SET summary_band = public._card_summary_band(_card.id)
     WHERE id = _card.id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.set_card_item_included(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_card_item_included(uuid, boolean) TO authenticated, service_role;

-- 11) RPC: publish (needs >= 3 included, answered questions) -----------------------
CREATE OR REPLACE FUNCTION public.publish_interview_card()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _card public.interview_cards%ROWTYPE;
  _n int;
  _band text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO _card FROM public.interview_cards WHERE candidate_id = _uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'card_not_found'; END IF;
  SELECT count(*) INTO _n FROM public.interview_card_items
   WHERE card_id = _card.id AND state = 'answered' AND include;
  IF _n < 3 THEN RAISE EXCEPTION 'min_included'; END IF;
  _band := public._card_summary_band(_card.id);
  UPDATE public.interview_cards
     SET status = 'published', summary_band = _band,
         published_at = COALESCE(published_at, now())
   WHERE id = _card.id;
  RETURN _band;
END $$;
REVOKE ALL ON FUNCTION public.publish_interview_card() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_interview_card() TO authenticated, service_role;

-- 12) RPC: attach / detach the card for one application ------------------------------
CREATE OR REPLACE FUNCTION public.set_application_card_share(_application_id uuid, _share boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _cid uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.applications WHERE id = _application_id AND candidate_id = _uid) THEN
    RAISE EXCEPTION 'application_not_found';
  END IF;

  IF _share THEN
    SELECT id INTO _cid FROM public.interview_cards WHERE candidate_id = _uid AND status = 'published';
    IF _cid IS NULL THEN RAISE EXCEPTION 'card_not_published'; END IF;
    INSERT INTO public.interview_card_shares (application_id, candidate_id, card_id)
    VALUES (_application_id, _uid, _cid)
    ON CONFLICT (application_id) DO UPDATE
      SET card_id = EXCLUDED.card_id, shared_at = now(), revoked_at = NULL;
  ELSE
    UPDATE public.interview_card_shares SET revoked_at = now()
     WHERE application_id = _application_id AND candidate_id = _uid AND revoked_at IS NULL;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.set_application_card_share(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_application_card_share(uuid, boolean) TO authenticated, service_role;

-- 13) RPC (employer): which applicants of a job have a shared card (badge data) ------
CREATE OR REPLACE FUNCTION public.get_job_interview_card_badges(_job_id uuid)
RETURNS TABLE (application_id uuid, summary_band text, answered_count int, language text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _company uuid;
BEGIN
  SELECT company_id INTO _company FROM public.jobs WHERE id = _job_id;
  IF _company IS NULL OR NOT public.has_company_membership(auth.uid(), _company) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  RETURN QUERY
  SELECT s.application_id, c.summary_band,
         (SELECT count(*)::int FROM public.interview_card_items i
           WHERE i.card_id = c.id AND i.state = 'answered' AND i.include),
         c.language
    FROM public.interview_card_shares s
    JOIN public.applications a ON a.id = s.application_id AND a.job_id = _job_id
    JOIN public.interview_cards c ON c.id = s.card_id AND c.status = 'published'
   WHERE s.revoked_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION public.get_job_interview_card_badges(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_job_interview_card_badges(uuid) TO authenticated, service_role;

-- 14) RPC (employer): open one applicant's shared card -------------------------------
-- Returns only what the candidate chose to include. Coaching tips / suggested
-- outlines are stripped from feedback — employers see the rubric bands + evidence.
-- Logs the view (once per viewer per hour) to employer_activity and for the candidate.
CREATE OR REPLACE FUNCTION public.get_applicant_interview_card(_application_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _app public.applications%ROWTYPE;
  _card public.interview_cards%ROWTYPE;
  _items jsonb;
  _name text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO _app FROM public.applications WHERE id = _application_id;
  IF NOT FOUND OR NOT public.has_company_membership(_uid, _app.company_id) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  SELECT c.* INTO _card
    FROM public.interview_card_shares s
    JOIN public.interview_cards c ON c.id = s.card_id AND c.status = 'published'
   WHERE s.application_id = _application_id AND s.revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_shared'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'position', i.position,
           'category', i.category,
           'question', i.question_text,
           'transcript', i.transcript,
           'duration_sec', i.duration_sec,
           'audio_path', i.audio_path,
           'voice_metrics', i.voice_metrics,
           'feedback', CASE WHEN i.feedback IS NULL THEN NULL ELSE jsonb_build_object(
               'criteria', COALESCE((SELECT jsonb_agg(cr - 'tip')
                                       FROM jsonb_array_elements(i.feedback->'criteria') cr), '[]'::jsonb),
               'strengths', COALESCE(i.feedback->'strengths', '[]'::jsonb)) END
         ) ORDER BY i.position), '[]'::jsonb)
    INTO _items
    FROM public.interview_card_items i
   WHERE i.card_id = _card.id AND i.state = 'answered' AND i.include;

  IF NOT EXISTS (SELECT 1 FROM public.interview_card_views
                  WHERE application_id = _application_id AND viewer_id = _uid
                    AND viewed_at > now() - interval '1 hour') THEN
    INSERT INTO public.interview_card_views (card_id, candidate_id, application_id, company_id, viewer_id)
    VALUES (_card.id, _card.candidate_id, _application_id, _app.company_id, _uid);
    SELECT full_name INTO _name FROM public.profiles WHERE id = _app.candidate_id;
    PERFORM public.log_employer_activity(
      _app.company_id, _uid, 'interview_card_viewed',
      'Interview Card viewed' || COALESCE(' · ' || _name, ''), NULL, NULL,
      jsonb_build_object('application_id', _application_id, 'job_id', _app.job_id));
  END IF;

  RETURN jsonb_build_object(
    'language', _card.language,
    'role_title', _card.role_title,
    'summary_band', _card.summary_band,
    'published_at', _card.published_at,
    'items', _items);
END $$;
REVOKE ALL ON FUNCTION public.get_applicant_interview_card(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_applicant_interview_card(uuid) TO authenticated, service_role;

-- 15) RPC (candidate): which companies viewed my card, and for which job -----------------
CREATE OR REPLACE FUNCTION public.get_my_interview_card_views()
RETURNS TABLE (company_name text, job_title text, viewed_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  RETURN QUERY
  SELECT co.name, j.title, v.last_viewed
    FROM (SELECT iv.application_id, iv.company_id, max(iv.viewed_at) AS last_viewed
            FROM public.interview_card_views iv
           WHERE iv.candidate_id = auth.uid()
           GROUP BY iv.application_id, iv.company_id) v
    JOIN public.companies co ON co.id = v.company_id
    JOIN public.applications a ON a.id = v.application_id
    JOIN public.jobs j ON j.id = a.job_id
   ORDER BY v.last_viewed DESC
   LIMIT 50;
END $$;
REVOKE ALL ON FUNCTION public.get_my_interview_card_views() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_interview_card_views() TO authenticated, service_role;
