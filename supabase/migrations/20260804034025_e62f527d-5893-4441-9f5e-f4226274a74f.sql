-- =====================================================================
-- INVOICING: invoices table + Indian-FY invoice numbering (JK/2026-27/0001)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.invoice_counters (
  financial_year text PRIMARY KEY,
  last_seq int NOT NULL DEFAULT 0
);
GRANT ALL ON public.invoice_counters TO service_role;
ALTER TABLE public.invoice_counters ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.current_financial_year()
RETURNS text LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXTRACT(month FROM now()) >= 4
      THEN EXTRACT(year FROM now())::text || '-' || to_char(now() + interval '1 year', 'YY')
    ELSE (EXTRACT(year FROM now()) - 1)::text || '-' || to_char(now(), 'YY')
  END;
$$;

CREATE OR REPLACE FUNCTION public.next_invoice_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _fy text; _seq int;
BEGIN
  _fy := public.current_financial_year();

  INSERT INTO public.invoice_counters (financial_year, last_seq)
    VALUES (_fy, 1)
    ON CONFLICT (financial_year)
    DO UPDATE SET last_seq = public.invoice_counters.last_seq + 1
    RETURNING last_seq INTO _seq;

  RETURN 'JK/' || _fy || '/' || lpad(_seq::text, 4, '0');
END;
$$;

CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  source text NOT NULL,
  source_id uuid,
  issue_date timestamptz NOT NULL DEFAULT now(),
  line_items jsonb NOT NULL,
  subtotal_inr numeric(12,2) NOT NULL,
  cgst_inr numeric(12,2) NOT NULL DEFAULT 0,
  sgst_inr numeric(12,2) NOT NULL DEFAULT 0,
  igst_inr numeric(12,2) NOT NULL DEFAULT 0,
  total_inr numeric(12,2) NOT NULL,
  buyer_snapshot jsonb NOT NULL,
  payment_method text NOT NULL,
  payment_reference text,
  payment_status text NOT NULL DEFAULT 'Paid',
  status text NOT NULL DEFAULT 'issued',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoices_company_idx ON public.invoices(company_id, issue_date DESC);
CREATE INDEX IF NOT EXISTS invoices_source_idx ON public.invoices(source, source_id);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_source_unique_idx ON public.invoices(source, source_id) WHERE source_id IS NOT NULL;

GRANT SELECT ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view their company invoices" ON public.invoices;
CREATE POLICY "Members can view their company invoices" ON public.invoices
  FOR SELECT TO authenticated
  USING (public.has_company_membership(auth.uid(), company_id));

CREATE OR REPLACE FUNCTION public.issue_credit_pack_invoice(
  _order_id uuid,
  _razorpay_payment_id text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _existing uuid;
  _order record;
  _pack record;
  _company record;
  _subtotal numeric(12,2);
  _gst numeric(12,2);
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
  IF _order IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO _pack FROM public.credit_packs WHERE id = _order.pack_id;
  SELECT * INTO _company FROM public.companies WHERE id = _order.company_id;

  _intra := false;

  _subtotal := round(_order.amount_inr / 1.18, 2);
  _gst := round(_order.amount_inr - _subtotal, 2);
  _cgst := CASE WHEN _intra THEN round(_gst / 2, 2) ELSE 0 END;
  _sgst := CASE WHEN _intra THEN round(_gst / 2, 2) ELSE 0 END;

  _inv_no := public.next_invoice_number();

  INSERT INTO public.invoices (
    invoice_number, company_id, source, source_id, line_items,
    subtotal_inr, cgst_inr, sgst_inr, igst_inr, total_inr,
    buyer_snapshot, payment_method, payment_reference, payment_status
  ) VALUES (
    _inv_no, _order.company_id, 'credit_pack', _order.id,
    jsonb_build_array(jsonb_build_object(
      'description', COALESCE(_pack.name, 'Credit') || ' Credit Pack — ' || COALESCE(_order.credits, 0) || ' candidate unlock credits',
      'hsn_sac', '998313',
      'qty', 1,
      'rate_inr', _subtotal
    )),
    _subtotal, _cgst, _sgst, CASE WHEN _intra THEN 0 ELSE _gst END, _order.amount_inr,
    jsonb_build_object(
      'name', _company.name, 'gstin', _company.gst_number,
      'pan', _company.pan_number, 'city', _company.hq_city
    ),
    'Razorpay', _razorpay_payment_id, 'Paid'
  )
  ON CONFLICT (invoice_number) DO NOTHING
  RETURNING id INTO _invoice_id;

  RETURN _invoice_id;
END;
$$;