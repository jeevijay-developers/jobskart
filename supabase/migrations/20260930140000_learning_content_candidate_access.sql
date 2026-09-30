-- ============================================================
-- Learning & Content Ecosystem — fixes required to actually use the schema
-- added in 20260930130000_learning_content_schema.sql:
--
-- 1. That migration gave `content_items` a public-read-published policy, but
--    every child table (content_posts, course_modules, course_lessons,
--    certifications) only had an admin-all policy — so a public/candidate
--    read that joins content_items to its child row (`certifications!inner(...)`
--    etc.) always returned zero rows, RLS silently dropping the join side.
-- 2. Candidates had no way to read their own candidate_orders, cert_purchases
--    or user_content_progress rows — only "Admins can manage" (all) policies
--    existed, so a candidate could never see their own purchase or progress.
-- 3. Per architecture.md rule 2 ("money and access logic lives in Postgres,
--    never in server functions or React"), certification order creation and
--    fulfilment need SECURITY DEFINER RPCs with row locks, mirroring
--    create_credit_pack_order() / fulfill_razorpay_order() exactly, instead
--    of the ad hoc TypeScript inserts the app code had. This migration adds
--    those RPCs; the app code is switched to call them.
-- ============================================================

-- ---------------------------------------------------------------------
-- 1. Public read for child content tables, scoped to a published parent
-- ---------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='content_posts' AND policyname='Anyone can read posts of published items') THEN
    CREATE POLICY "Anyone can read posts of published items" ON public.content_posts
      FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.content_items ci WHERE ci.id = content_posts.id AND ci.status = 'published')
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='course_modules' AND policyname='Anyone can read modules of published courses') THEN
    CREATE POLICY "Anyone can read modules of published courses" ON public.course_modules
      FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.content_items ci WHERE ci.id = course_modules.course_id AND ci.status = 'published')
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='course_lessons' AND policyname='Anyone can read lessons of published courses') THEN
    CREATE POLICY "Anyone can read lessons of published courses" ON public.course_lessons
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM public.course_modules m
          JOIN public.content_items ci ON ci.id = m.course_id
          WHERE m.id = course_lessons.module_id AND ci.status = 'published'
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='certifications' AND policyname='Anyone can read published certifications') THEN
    CREATE POLICY "Anyone can read published certifications" ON public.certifications
      FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.content_items ci WHERE ci.id = certifications.id AND ci.status = 'published')
      );
  END IF;
END $$;

-- cert_questions deliberately keeps admin-only read: exam questions must
-- never be shippable to a browser before purchase/attempt is server-checked.

-- ---------------------------------------------------------------------
-- 2. Candidates can read (never write directly) their own order/purchase/
--    progress rows. Writes to orders/purchases stay RPC-only (below); a
--    candidate can read but never insert/update/delete those two directly.
-- ---------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='candidate_orders' AND policyname='owner select own orders') THEN
    CREATE POLICY "owner select own orders" ON public.candidate_orders
      FOR SELECT TO authenticated USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cert_purchases' AND policyname='owner select own purchases') THEN
    CREATE POLICY "owner select own purchases" ON public.cert_purchases
      FOR SELECT TO authenticated USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_content_progress' AND policyname='owner manage own progress') THEN
    CREATE POLICY "owner manage own progress" ON public.user_content_progress
      FOR ALL TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- candidate_orders needs a payment-id column before the RPCs below reference
-- it (fulfil records the Razorpay payment id that fulfilled an order).
ALTER TABLE public.candidate_orders
  ADD COLUMN IF NOT EXISTS razorpay_payment_id text;

-- ---------------------------------------------------------------------
-- 3. create_certification_order(): freezes the price server-side (never
--    trusts a client-sent amount) and opens a 'created' order row.
--    Mirrors create_credit_pack_order() in 20260923064309_razorpay_hardening_gst.sql.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_certification_order(
  _certification_id uuid,
  _actor uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _cert record;
  _paise bigint;
  _id uuid;
BEGIN
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT c.id, c.price_inr, ci.title, ci.status INTO _cert
    FROM public.certifications c
    JOIN public.content_items ci ON ci.id = c.id
    WHERE c.id = _certification_id;
  IF NOT FOUND OR _cert.status <> 'published' THEN
    RAISE EXCEPTION 'certification_unavailable';
  END IF;
  IF _cert.price_inr <= 0 THEN
    RAISE EXCEPTION 'certification_free';
  END IF;

  -- Repeat purchases are free (idempotent) — don't open a new order for a
  -- certification the candidate already owns.
  IF EXISTS (
    SELECT 1 FROM public.cert_purchases
    WHERE user_id = _actor AND certification_id = _certification_id
  ) THEN
    RAISE EXCEPTION 'already_purchased';
  END IF;

  _paise := round(_cert.price_inr * 100)::bigint;

  INSERT INTO public.candidate_orders (user_id, certification_id, amount, currency, status)
  VALUES (_actor, _certification_id, _cert.price_inr, 'INR', 'created')
  RETURNING id INTO _id;

  RETURN jsonb_build_object(
    'order_id', _id,
    'amount_paise', _paise,
    'amount_inr', _cert.price_inr,
    'title', _cert.title
  );
END;
$$;

-- ---------------------------------------------------------------------
-- 4. fulfil_certification_order(): the only path that grants a certificate
--    purchase. Row-locks the order so the client-verify path and the
--    webhook can never double-grant. Mirrors fulfill_razorpay_order().
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fulfil_certification_order(
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

  SELECT * INTO _o
    FROM public.candidate_orders
    WHERE razorpay_order_id = _razorpay_order_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  IF _actor IS NOT NULL AND _o.user_id <> _actor THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  IF _o.status = 'paid' THEN
    SELECT certificate_no INTO _cert_no FROM public.cert_purchases
      WHERE user_id = _o.user_id AND certification_id = _o.certification_id;
    RETURN jsonb_build_object('status', 'paid', 'already_applied', true, 'certificate_no', _cert_no);
  END IF;

  _expected := round(_o.amount * 100)::bigint;
  IF _amount_paise IS NOT NULL AND _amount_paise <> _expected THEN
    UPDATE public.candidate_orders SET status = 'failed' WHERE id = _o.id;
    RETURN jsonb_build_object('status', 'amount_mismatch', 'already_applied', false, 'certificate_no', NULL);
  END IF;

  _cert_no := 'JK-CERT-' || upper(substr(md5(_o.id::text || now()::text), 1, 8));

  INSERT INTO public.cert_purchases (user_id, certification_id, certificate_no)
  VALUES (_o.user_id, _o.certification_id, _cert_no)
  ON CONFLICT (user_id, certification_id) DO NOTHING;

  -- Someone else's concurrent call already inserted the purchase; use that row's number.
  IF NOT FOUND THEN
    SELECT certificate_no INTO _cert_no FROM public.cert_purchases
      WHERE user_id = _o.user_id AND certification_id = _o.certification_id;
  END IF;

  UPDATE public.candidate_orders
    SET status = 'paid', razorpay_payment_id = _razorpay_payment_id
    WHERE id = _o.id;

  RETURN jsonb_build_object('status', 'paid', 'already_applied', false, 'certificate_no', _cert_no);
END;
$$;

-- ---------------------------------------------------------------------
-- 5. mark_certification_order_failed(): records a failed attempt, mirrors
--    mark_razorpay_order_failed().
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_certification_order_failed(
  _razorpay_order_id text,
  _razorpay_payment_id text
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.candidate_orders
    SET status = 'failed',
        razorpay_payment_id = coalesce(_razorpay_payment_id, razorpay_payment_id)
    WHERE razorpay_order_id = _razorpay_order_id AND status = 'created';
$$;

-- Same trust boundary as the credit-pack RPCs: service_role only. The client
-- and webhook paths both go through TanStack server functions using the
-- admin client, never a direct client RPC call.
REVOKE ALL ON FUNCTION public.create_certification_order(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fulfil_certification_order(text, text, bigint, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_certification_order_failed(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_certification_order(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fulfil_certification_order(text, text, bigint, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_certification_order_failed(text, text) TO service_role;
