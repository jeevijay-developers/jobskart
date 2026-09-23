-- =====================================================================
-- RAZORPAY HARDENING
--   1. GST-exclusive pricing: pack price is the ex-GST subtotal, 18% GST is
--      charged on top. The quote is frozen on the order row at creation.
--   2. Atomic, idempotent fulfilment: the client verify path and the webhook
--      both call fulfill_razorpay_order(), which row-locks the order so the
--      two can never double-credit.
--   3. Failed / mismatched payments are recorded instead of left 'created'.
--   4. Ledger-level guard: one purchase credit per razorpay_payment_id.
--   5. Invoice tax split: CGST+SGST for Rajasthan buyers, IGST otherwise.
-- Re-runnable.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. razorpay_orders: frozen quote + fulfilment metadata
-- ---------------------------------------------------------------------
-- amount_inr stays the pack's ex-GST price. Rows created before this
-- migration have amount_paise NULL and were charged amount_inr GST-inclusive.
ALTER TABLE public.razorpay_orders
  ADD COLUMN IF NOT EXISTS subtotal_inr numeric(12,2),
  ADD COLUMN IF NOT EXISTS gst_inr numeric(12,2),
  ADD COLUMN IF NOT EXISTS amount_paise bigint,
  ADD COLUMN IF NOT EXISTS fulfilled_via text,
  ADD COLUMN IF NOT EXISTS failure_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'razorpay_orders_status_check'
      AND conrelid = 'public.razorpay_orders'::regclass
  ) THEN
    ALTER TABLE public.razorpay_orders
      ADD CONSTRAINT razorpay_orders_status_check
      CHECK (status IN ('created', 'paid', 'failed', 'amount_mismatch'));
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. Ledger guard: a Razorpay payment can be credited at most once
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.credit_transactions
    WHERE kind = 'purchase' AND reference ? 'razorpay_payment_id'
    GROUP BY reference->>'razorpay_payment_id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate purchase credits exist for a razorpay_payment_id; resolve them before applying this migration.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS credit_transactions_purchase_payment_uniq
  ON public.credit_transactions ((reference->>'razorpay_payment_id'))
  WHERE kind = 'purchase' AND reference ? 'razorpay_payment_id';

-- ---------------------------------------------------------------------
-- 3. GST state helpers
-- ---------------------------------------------------------------------
-- Buyer's GST state code: GSTIN prefix when present, else Rajasthan (08) for
-- 30xxxx-34xxxx pincodes, else NULL. The pincode fallback only resolves
-- Rajasthan because that is all the intra/inter-state decision needs.
CREATE OR REPLACE FUNCTION public.buyer_gst_state_code(_gstin text, _pincode text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN upper(btrim(coalesce(_gstin, ''))) ~ '^[0-9]{2}[A-Z0-9]{13}$'
      THEN left(btrim(_gstin), 2)
    WHEN btrim(coalesce(_pincode, '')) ~ '^3[0-4][0-9]{4}$'
      THEN '08'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.gst_state_name(_code text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _code
    WHEN '01' THEN 'Jammu and Kashmir'     WHEN '02' THEN 'Himachal Pradesh'
    WHEN '03' THEN 'Punjab'                WHEN '04' THEN 'Chandigarh'
    WHEN '05' THEN 'Uttarakhand'           WHEN '06' THEN 'Haryana'
    WHEN '07' THEN 'Delhi'                 WHEN '08' THEN 'Rajasthan'
    WHEN '09' THEN 'Uttar Pradesh'         WHEN '10' THEN 'Bihar'
    WHEN '11' THEN 'Sikkim'                WHEN '12' THEN 'Arunachal Pradesh'
    WHEN '13' THEN 'Nagaland'              WHEN '14' THEN 'Manipur'
    WHEN '15' THEN 'Mizoram'               WHEN '16' THEN 'Tripura'
    WHEN '17' THEN 'Meghalaya'             WHEN '18' THEN 'Assam'
    WHEN '19' THEN 'West Bengal'           WHEN '20' THEN 'Jharkhand'
    WHEN '21' THEN 'Odisha'                WHEN '22' THEN 'Chhattisgarh'
    WHEN '23' THEN 'Madhya Pradesh'        WHEN '24' THEN 'Gujarat'
    WHEN '26' THEN 'Dadra and Nagar Haveli and Daman and Diu'
    WHEN '27' THEN 'Maharashtra'           WHEN '29' THEN 'Karnataka'
    WHEN '30' THEN 'Goa'                   WHEN '31' THEN 'Lakshadweep'
    WHEN '32' THEN 'Kerala'                WHEN '33' THEN 'Tamil Nadu'
    WHEN '34' THEN 'Puducherry'            WHEN '35' THEN 'Andaman and Nicobar Islands'
    WHEN '36' THEN 'Telangana'             WHEN '37' THEN 'Andhra Pradesh'
    WHEN '38' THEN 'Ladakh'
    ELSE NULL
  END;
$$;

-- ---------------------------------------------------------------------
-- 4. create_credit_pack_order(): quote + insert the pending order
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_credit_pack_order(
  _company_id uuid,
  _pack_id uuid,
  _actor uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _pack record;
  _subtotal numeric(12,2);
  _gst numeric(12,2);
  _paise bigint;
  _id uuid;
BEGIN
  IF _actor IS NULL OR NOT public.has_company_membership(_actor, _company_id) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  SELECT id, name, credits, price_inr INTO _pack
    FROM public.credit_packs
    WHERE id = _pack_id AND active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pack_unavailable';
  END IF;

  _subtotal := _pack.price_inr;
  _gst := round(_subtotal * 0.18, 2);
  _paise := round((_subtotal + _gst) * 100)::bigint;

  INSERT INTO public.razorpay_orders (
    company_id, pack_id, amount_inr, credits,
    subtotal_inr, gst_inr, amount_paise, status, created_by
  ) VALUES (
    _company_id, _pack.id, _pack.price_inr, _pack.credits,
    _subtotal, _gst, _paise, 'created', _actor
  )
  RETURNING id INTO _id;

  RETURN jsonb_build_object(
    'order_id', _id,
    'amount_paise', _paise,
    'subtotal_inr', _subtotal,
    'gst_inr', _gst,
    'credits', _pack.credits,
    'pack_name', _pack.name
  );
END;
$$;

-- ---------------------------------------------------------------------
-- 5. fulfill_razorpay_order(): the only path that grants purchased credits
-- ---------------------------------------------------------------------
-- _amount_paise: amount Razorpay reports as paid (webhook). NULL skips the
--   check (client path — the verified signature already binds the order).
-- _actor: the calling user (client path, membership enforced) or NULL
--   (webhook, trusted by HMAC).
CREATE OR REPLACE FUNCTION public.fulfill_razorpay_order(
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
  _o public.razorpay_orders%ROWTYPE;
  _expected bigint;
  _bal int;
BEGIN
  IF _via NOT IN ('client', 'webhook') THEN
    RAISE EXCEPTION 'invalid_via';
  END IF;

  SELECT * INTO _o
    FROM public.razorpay_orders
    WHERE razorpay_order_id = _razorpay_order_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  IF _actor IS NOT NULL AND NOT public.has_company_membership(_actor, _o.company_id) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  IF _o.status = 'paid' THEN
    SELECT balance INTO _bal FROM public.employer_credit_wallets WHERE company_id = _o.company_id;
    RETURN jsonb_build_object('status', 'paid', 'already_applied', true, 'balance', coalesce(_bal, 0));
  END IF;

  IF _o.status = 'amount_mismatch' THEN
    RETURN jsonb_build_object('status', 'amount_mismatch', 'already_applied', false, 'balance', NULL);
  END IF;

  -- 'created' or 'failed' (Razorpay allows a retry on the same order).
  _expected := coalesce(_o.amount_paise, _o.amount_inr::bigint * 100);
  IF _amount_paise IS NOT NULL AND _amount_paise <> _expected THEN
    UPDATE public.razorpay_orders
      SET status = 'amount_mismatch',
          razorpay_payment_id = _razorpay_payment_id,
          fulfilled_via = _via,
          failure_reason = format('Paid %s paise, expected %s paise', _amount_paise, _expected)
      WHERE id = _o.id;
    RETURN jsonb_build_object('status', 'amount_mismatch', 'already_applied', false, 'balance', NULL);
  END IF;

  _bal := public.apply_credit_delta(
    _o.company_id, _o.credits, 'purchase'::public.credit_txn_kind,
    jsonb_build_object('order_id', _o.id, 'razorpay_payment_id', _razorpay_payment_id, 'via', _via),
    _actor
  );

  -- Invoice failure must never block credit delivery (rule 7). The nested
  -- block rolls back only the invoice attempt.
  BEGIN
    PERFORM public.issue_credit_pack_invoice(_o.id, _razorpay_payment_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'issue_credit_pack_invoice failed for order %: %', _o.id, SQLERRM;
  END;

  UPDATE public.razorpay_orders
    SET status = 'paid',
        razorpay_payment_id = _razorpay_payment_id,
        fulfilled_via = _via,
        failure_reason = NULL
    WHERE id = _o.id;

  RETURN jsonb_build_object('status', 'paid', 'already_applied', false, 'balance', _bal);
END;
$$;

-- ---------------------------------------------------------------------
-- 6. mark_razorpay_order_failed(): record a failed attempt
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_razorpay_order_failed(
  _razorpay_order_id text,
  _razorpay_payment_id text,
  _reason text
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.razorpay_orders
    SET status = 'failed',
        razorpay_payment_id = coalesce(_razorpay_payment_id, razorpay_payment_id),
        failure_reason = left(coalesce(_reason, 'payment_failed'), 500)
    WHERE razorpay_order_id = _razorpay_order_id
      AND status IN ('created', 'failed');
$$;

-- ---------------------------------------------------------------------
-- 7. issue_credit_pack_invoice(): GST-on-top amounts + intra/inter split
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_credit_pack_invoice(
  _order_id uuid,
  _razorpay_payment_id text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _seller_state constant text := '08'; -- Rajasthan; keep in sync with SELLER in src/lib/invoice-pdf.ts
  _existing uuid;
  _order record;
  _pack record;
  _company record;
  _state_code text;
  _subtotal numeric(12,2);
  _gst numeric(12,2);
  _total numeric(12,2);
  _cgst numeric(12,2);
  _sgst numeric(12,2);
  _intra boolean;
  _invoice_id uuid;
  _inv_no text;
BEGIN
  SELECT id INTO _existing FROM public.invoices WHERE source = 'credit_pack' AND source_id = _order_id;
  IF _existing IS NOT NULL THEN
    RETURN _existing;
  END IF;

  SELECT * INTO _order FROM public.razorpay_orders WHERE id = _order_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO _pack FROM public.credit_packs WHERE id = _order.pack_id;
  SELECT * INTO _company FROM public.companies WHERE id = _order.company_id;

  IF _order.amount_paise IS NOT NULL THEN
    _subtotal := _order.subtotal_inr;
    _gst := _order.gst_inr;
    _total := round(_order.amount_paise / 100.0, 2);
  ELSE
    -- Legacy order: amount_inr was charged GST-inclusive.
    _total := _order.amount_inr;
    _subtotal := round(_order.amount_inr / 1.18, 2);
    _gst := round(_total - _subtotal, 2);
  END IF;

  _state_code := public.buyer_gst_state_code(_company.gst_number, _company.pincode);
  _intra := coalesce(_state_code = _seller_state, false);
  _cgst := CASE WHEN _intra THEN round(_gst / 2, 2) ELSE 0 END;
  _sgst := CASE WHEN _intra THEN _gst - _cgst ELSE 0 END;

  _inv_no := public.next_invoice_number();

  INSERT INTO public.invoices (
    invoice_number, company_id, source, source_id, line_items,
    subtotal_inr, cgst_inr, sgst_inr, igst_inr, total_inr,
    buyer_snapshot, payment_method, payment_reference, payment_status
  ) VALUES (
    _inv_no, _order.company_id, 'credit_pack', _order.id,
    jsonb_build_array(jsonb_build_object(
      'description', coalesce(_pack.name, 'Credit') || ' Credit Pack — ' || coalesce(_order.credits, 0) || ' candidate unlock credits',
      'hsn_sac', '998313',
      'qty', 1,
      'rate_inr', _subtotal
    )),
    _subtotal, _cgst, _sgst, CASE WHEN _intra THEN 0 ELSE _gst END, _total,
    jsonb_build_object(
      'name', _company.name, 'gstin', _company.gst_number,
      'pan', _company.pan_number, 'city', _company.hq_city,
      'pincode', _company.pincode,
      'state_code', _state_code,
      'state', public.gst_state_name(_state_code)
    ),
    'Razorpay', _razorpay_payment_id, 'Paid'
  )
  ON CONFLICT (invoice_number) DO NOTHING
  RETURNING id INTO _invoice_id;

  RETURN _invoice_id;
END;
$$;

-- ---------------------------------------------------------------------
-- 8. Privileges: server (service_role) only
-- ---------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.create_credit_pack_order(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fulfill_razorpay_order(text, text, bigint, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_razorpay_order_failed(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.issue_credit_pack_invoice(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_credit_pack_order(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fulfill_razorpay_order(text, text, bigint, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_razorpay_order_failed(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_credit_pack_invoice(uuid, text) TO service_role;
