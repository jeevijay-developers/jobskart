-- ============================================================
-- Purchase-gated courses + exam-taking, and closing a real leak: RLS is
-- row-level (published or not), so certifications.questions (the exam
-- answer key) and course_lessons body_md/video_url were fully readable by
-- ANY signed-in or anonymous user via a direct table query, regardless of
-- purchase — the "you must buy it first" check only lived in the UI.
-- Fixed here with column-level REVOKE/GRANT: those columns become
-- service-role-only, delivered through masked SECURITY DEFINER RPCs that
-- check ownership first (same principle as unlock_candidate() for
-- locked candidate contact data — see architecture.md rule 3).
-- ============================================================

-- 1) courses: a course becomes a purchasable item, same shape as certifications
CREATE TABLE IF NOT EXISTS public.courses (
  id uuid PRIMARY KEY REFERENCES public.content_items(id) ON DELETE CASCADE,
  price_inr integer NOT NULL DEFAULT 0
);
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.courses TO anon, authenticated;
GRANT ALL ON public.courses TO service_role;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='courses' AND policyname='Anyone can read published courses') THEN
    CREATE POLICY "Anyone can read published courses" ON public.courses
      FOR SELECT USING (EXISTS (SELECT 1 FROM public.content_items ci WHERE ci.id = courses.id AND ci.status = 'published'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='courses' AND policyname='Admins can manage courses') THEN
    CREATE POLICY "Admins can manage courses" ON public.courses
      FOR ALL TO authenticated
      USING (public.has_platform_role(auth.uid(),'super_admin'))
      WITH CHECK (public.has_platform_role(auth.uid(),'super_admin'));
  END IF;
END $$;

-- Backfill a courses row for every existing course content_item (price 0 = free,
-- so nothing that's already published becomes newly locked by this migration).
INSERT INTO public.courses (id, price_inr)
SELECT id, 0 FROM public.content_items WHERE content_type = 'course'
ON CONFLICT (id) DO NOTHING;

-- 2) course_purchases: entitlement table, mirrors cert_purchases
CREATE TABLE IF NOT EXISTS public.course_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  purchased_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, course_id)
);
ALTER TABLE public.course_purchases ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.course_purchases TO service_role;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='course_purchases' AND policyname='owner select own course purchases') THEN
    CREATE POLICY "owner select own course purchases" ON public.course_purchases
      FOR SELECT TO authenticated USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='course_purchases' AND policyname='Admins can manage course_purchases') THEN
    CREATE POLICY "Admins can manage course_purchases" ON public.course_purchases
      FOR ALL TO authenticated
      USING (public.has_platform_role(auth.uid(),'super_admin'))
      WITH CHECK (public.has_platform_role(auth.uid(),'super_admin'));
  END IF;
END $$;
GRANT SELECT ON public.course_purchases TO authenticated; -- gated to own rows by the policy above

-- 3) Generalize candidate_orders to cover courses too, not just certifications
ALTER TABLE public.candidate_orders
  ADD COLUMN IF NOT EXISTS item_type text NOT NULL DEFAULT 'certification',
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES public.courses(id) ON DELETE CASCADE;
ALTER TABLE public.candidate_orders ALTER COLUMN certification_id DROP NOT NULL;
ALTER TABLE public.candidate_orders DROP CONSTRAINT IF EXISTS candidate_orders_item_type_check;
ALTER TABLE public.candidate_orders
  ADD CONSTRAINT candidate_orders_item_type_check CHECK (item_type IN ('certification','course'));
ALTER TABLE public.candidate_orders DROP CONSTRAINT IF EXISTS candidate_orders_item_ref_check;
ALTER TABLE public.candidate_orders
  ADD CONSTRAINT candidate_orders_item_ref_check CHECK (
    (item_type = 'certification' AND certification_id IS NOT NULL AND course_id IS NULL) OR
    (item_type = 'course' AND course_id IS NOT NULL AND certification_id IS NULL)
  );

-- 4) create_course_order(): mirrors create_certification_order exactly
CREATE OR REPLACE FUNCTION public.create_course_order(
  _course_id uuid,
  _actor uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _c record;
  _paise bigint;
  _id uuid;
BEGIN
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT c.id, c.price_inr, ci.title, ci.status INTO _c
    FROM public.courses c
    JOIN public.content_items ci ON ci.id = c.id
    WHERE c.id = _course_id;
  IF NOT FOUND OR _c.status <> 'published' THEN
    RAISE EXCEPTION 'course_unavailable';
  END IF;
  IF _c.price_inr <= 0 THEN
    RAISE EXCEPTION 'course_free';
  END IF;

  IF EXISTS (SELECT 1 FROM public.course_purchases WHERE user_id = _actor AND course_id = _course_id) THEN
    RAISE EXCEPTION 'already_purchased';
  END IF;

  _paise := round(_c.price_inr * 100)::bigint;

  INSERT INTO public.candidate_orders (user_id, item_type, course_id, amount, currency, status)
  VALUES (_actor, 'course', _course_id, _c.price_inr, 'INR', 'created')
  RETURNING id INTO _id;

  RETURN jsonb_build_object('order_id', _id, 'amount_paise', _paise, 'amount_inr', _c.price_inr, 'title', _c.title);
END;
$$;

-- 5) fulfil_candidate_order(): replaces fulfil_certification_order. Reads the
-- locked order row's item_type and grants the right entitlement — one path
-- for both products, so the client-verify call and the webhook can never
-- double-grant either, exactly as before.
DROP FUNCTION IF EXISTS public.fulfil_certification_order(text, text, bigint, text, uuid);

CREATE OR REPLACE FUNCTION public.fulfil_candidate_order(
  _razorpay_order_id text,
  _razorpay_payment_id text,
  _amount_paise bigint,
  _via text,
  _actor uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _o public.candidate_orders%ROWTYPE;
  _expected bigint;
  _cert_no text;
BEGIN
  IF _via NOT IN ('client', 'webhook') THEN
    RAISE EXCEPTION 'invalid_via';
  END IF;

  SELECT * INTO _o FROM public.candidate_orders WHERE razorpay_order_id = _razorpay_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  IF _actor IS NOT NULL AND _o.user_id <> _actor THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  IF _o.status = 'paid' THEN
    IF _o.item_type = 'certification' THEN
      SELECT certificate_no INTO _cert_no FROM public.cert_purchases
        WHERE user_id = _o.user_id AND certification_id = _o.certification_id;
    END IF;
    RETURN jsonb_build_object('status', 'paid', 'already_applied', true, 'item_type', _o.item_type, 'certificate_no', _cert_no);
  END IF;

  _expected := round(_o.amount * 100)::bigint;
  IF _amount_paise IS NOT NULL AND _amount_paise <> _expected THEN
    UPDATE public.candidate_orders SET status = 'failed' WHERE id = _o.id;
    RETURN jsonb_build_object('status', 'amount_mismatch', 'already_applied', false, 'item_type', _o.item_type, 'certificate_no', NULL);
  END IF;

  IF _o.item_type = 'certification' THEN
    _cert_no := 'JK-CERT-' || upper(substr(md5(_o.id::text || now()::text), 1, 8));
    INSERT INTO public.cert_purchases (user_id, certification_id, certificate_no)
    VALUES (_o.user_id, _o.certification_id, _cert_no)
    ON CONFLICT (user_id, certification_id) DO NOTHING;
    IF NOT FOUND THEN
      SELECT certificate_no INTO _cert_no FROM public.cert_purchases
        WHERE user_id = _o.user_id AND certification_id = _o.certification_id;
    END IF;
  ELSE
    INSERT INTO public.course_purchases (user_id, course_id)
    VALUES (_o.user_id, _o.course_id)
    ON CONFLICT (user_id, course_id) DO NOTHING;
  END IF;

  UPDATE public.candidate_orders
    SET status = 'paid', razorpay_payment_id = _razorpay_payment_id
    WHERE id = _o.id;

  RETURN jsonb_build_object('status', 'paid', 'already_applied', false, 'item_type', _o.item_type, 'certificate_no', _cert_no);
END;
$$;

-- mark_certification_order_failed() never had certification-specific logic
-- (it just flips status by razorpay_order_id) — rename for honesty now that
-- it serves both order types, rather than adding a near-duplicate.
DROP FUNCTION IF EXISTS public.mark_certification_order_failed(text, text);
CREATE OR REPLACE FUNCTION public.mark_candidate_order_failed(
  _razorpay_order_id text,
  _razorpay_payment_id text
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.candidate_orders
    SET status = 'failed', razorpay_payment_id = coalesce(_razorpay_payment_id, razorpay_payment_id)
    WHERE razorpay_order_id = _razorpay_order_id AND status = 'created';
$$;

REVOKE ALL ON FUNCTION public.create_course_order(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fulfil_candidate_order(text, text, bigint, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_candidate_order_failed(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_course_order(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fulfil_candidate_order(text, text, bigint, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_candidate_order_failed(text, text) TO service_role;

-- 6) Column-level lockdown: revoke the sensitive columns from the broad
-- table grants added earlier, so a direct browser query cannot read them
-- regardless of purchase state. service_role (already GRANT ALL) is
-- unaffected — the masked RPCs below use supabaseAdmin.
REVOKE SELECT (body_md, video_url) ON public.course_modules FROM anon, authenticated;
REVOKE SELECT (body_md, video_url) ON public.course_lessons FROM anon, authenticated;
REVOKE SELECT (questions) ON public.certifications FROM anon, authenticated;
-- Explicit allow-list for what browsing (syllabus / certification details) may read.
GRANT SELECT (id, course_id, position, title, kind, free_preview, duration_minutes) ON public.course_modules TO anon, authenticated;
GRANT SELECT (id, module_id, position, title, kind, free_preview, duration_minutes) ON public.course_lessons TO anon, authenticated;
GRANT SELECT (id, price_inr, provider, partner_name, pass_mark, max_attempts, validity_months) ON public.certifications TO anon, authenticated;

-- 7) get_lesson_content(): the only way to read a locked lesson's body/video.
CREATE OR REPLACE FUNCTION public.get_lesson_content(_lesson_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _l record;
  _unlocked boolean;
BEGIN
  SELECT l.id, l.title, l.kind, l.video_url, l.body_md, l.free_preview,
         co.id AS course_id, co.price_inr, ci.status
    INTO _l
    FROM public.course_lessons l
    JOIN public.course_modules m ON m.id = l.module_id
    JOIN public.courses co ON co.id = m.course_id
    JOIN public.content_items ci ON ci.id = co.id
   WHERE l.id = _lesson_id;
  IF NOT FOUND OR _l.status <> 'published' THEN
    RAISE EXCEPTION 'lesson_not_found';
  END IF;

  _unlocked := _l.free_preview OR _l.price_inr <= 0
    OR (_uid IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.course_purchases WHERE user_id = _uid AND course_id = _l.course_id));
  IF NOT _unlocked THEN
    RAISE EXCEPTION 'locked';
  END IF;

  RETURN jsonb_build_object('title', _l.title, 'kind', _l.kind, 'videoUrl', _l.video_url, 'bodyMd', _l.body_md);
END;
$$;
REVOKE ALL ON FUNCTION public.get_lesson_content(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_lesson_content(uuid) TO anon, authenticated;

-- 8) Certification exam attempts
CREATE TABLE IF NOT EXISTS public.cert_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  certification_id uuid NOT NULL REFERENCES public.certifications(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL,
  answers jsonb NOT NULL,
  score integer NOT NULL,
  passed boolean NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, certification_id, attempt_number)
);
ALTER TABLE public.cert_attempts ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.cert_attempts TO service_role;
GRANT SELECT ON public.cert_attempts TO authenticated;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cert_attempts' AND policyname='owner select own attempts') THEN
    CREATE POLICY "owner select own attempts" ON public.cert_attempts
      FOR SELECT TO authenticated USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cert_attempts' AND policyname='Admins can manage cert_attempts') THEN
    CREATE POLICY "Admins can manage cert_attempts" ON public.cert_attempts
      FOR ALL TO authenticated
      USING (public.has_platform_role(auth.uid(),'super_admin'))
      WITH CHECK (public.has_platform_role(auth.uid(),'super_admin'));
  END IF;
END $$;

-- 9) get_certification_exam(): questions with the answer key stripped.
-- questions shape: [{ "id": text, "text": text, "options": text[] }, ...]
-- (the stored "correct" index is intentionally never included in the result).
CREATE OR REPLACE FUNCTION public.get_certification_exam(_certification_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _c record;
  _used int;
  _questions jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT pass_mark, max_attempts, questions INTO _c FROM public.certifications WHERE id = _certification_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'certification_unavailable'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.cert_purchases WHERE user_id = _uid AND certification_id = _certification_id) THEN
    RAISE EXCEPTION 'not_purchased';
  END IF;

  SELECT count(*) INTO _used FROM public.cert_attempts
   WHERE user_id = _uid AND certification_id = _certification_id;
  IF _used >= _c.max_attempts THEN RAISE EXCEPTION 'attempts_exhausted'; END IF;

  SELECT jsonb_agg(jsonb_build_object('id', q->>'id', 'text', q->>'text', 'options', q->'options'))
    INTO _questions
    FROM jsonb_array_elements(coalesce(_c.questions, '[]'::jsonb)) q;

  RETURN jsonb_build_object(
    'questions', coalesce(_questions, '[]'::jsonb),
    'passMark', _c.pass_mark,
    'maxAttempts', _c.max_attempts,
    'attemptsUsed', _used
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_certification_exam(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_certification_exam(uuid) TO authenticated;

-- 10) submit_certification_exam(): grades server-side against the real
-- answer key. Advisory-locked per (user, certification) so a double-submit
-- (two tabs) can't create two attempts with the same attempt_number.
CREATE OR REPLACE FUNCTION public.submit_certification_exam(_certification_id uuid, _answers jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _c record;
  _used int;
  _total int := 0;
  _correct_count int := 0;
  _q jsonb;
  _given int;
  _score int;
  _passed boolean;
  _attempt_no int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF jsonb_typeof(_answers) <> 'object' THEN RAISE EXCEPTION 'invalid_answers'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_uid::text || ':cert:' || _certification_id::text, 0));

  SELECT pass_mark, max_attempts, questions INTO _c FROM public.certifications WHERE id = _certification_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'certification_unavailable'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.cert_purchases WHERE user_id = _uid AND certification_id = _certification_id) THEN
    RAISE EXCEPTION 'not_purchased';
  END IF;

  SELECT count(*) INTO _used FROM public.cert_attempts
   WHERE user_id = _uid AND certification_id = _certification_id;
  IF _used >= _c.max_attempts THEN RAISE EXCEPTION 'attempts_exhausted'; END IF;
  _attempt_no := _used + 1;

  FOR _q IN SELECT * FROM jsonb_array_elements(coalesce(_c.questions, '[]'::jsonb))
  LOOP
    _total := _total + 1;
    -- ->> (text) then cast, not -> (jsonb): a malformed/missing answer must count
    -- as wrong, never abort the whole submission.
    BEGIN
      _given := (_answers ->> (_q ->> 'id'))::int;
    EXCEPTION WHEN OTHERS THEN
      _given := NULL;
    END;
    IF _given IS NOT NULL AND _given = (_q ->> 'correct')::int THEN
      _correct_count := _correct_count + 1;
    END IF;
  END LOOP;

  _score := CASE WHEN _total = 0 THEN 0 ELSE round((_correct_count::numeric / _total) * 100) END;
  _passed := _score >= _c.pass_mark;

  INSERT INTO public.cert_attempts (user_id, certification_id, attempt_number, answers, score, passed)
  VALUES (_uid, _certification_id, _attempt_no, _answers, _score, _passed);

  RETURN jsonb_build_object(
    'score', _score, 'passed', _passed, 'correctCount', _correct_count, 'total', _total,
    'attemptsUsed', _attempt_no, 'maxAttempts', _c.max_attempts
  );
END;
$$;
REVOKE ALL ON FUNCTION public.submit_certification_exam(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_certification_exam(uuid, jsonb) TO authenticated;
