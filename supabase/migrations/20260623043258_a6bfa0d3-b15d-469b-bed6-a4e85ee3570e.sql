
-- Enum for credit transaction kinds
DO $$ BEGIN
  CREATE TYPE public.credit_txn_kind AS ENUM ('purchase','unlock','refund','bonus','adjustment');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 1. credit_packs
CREATE TABLE public.credit_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  credits int NOT NULL CHECK (credits > 0),
  price_inr int NOT NULL CHECK (price_inr >= 0),
  badge text,
  sort int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.credit_packs TO anon, authenticated;
GRANT ALL ON public.credit_packs TO service_role;
ALTER TABLE public.credit_packs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view active packs" ON public.credit_packs FOR SELECT USING (active = true);

-- 2. employer_credit_wallets
CREATE TABLE public.employer_credit_wallets (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  balance int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.employer_credit_wallets TO authenticated;
GRANT ALL ON public.employer_credit_wallets TO service_role;
ALTER TABLE public.employer_credit_wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view wallet" ON public.employer_credit_wallets
  FOR SELECT TO authenticated
  USING (public.has_company_membership(auth.uid(), company_id));

-- 3. credit_transactions
CREATE TABLE public.credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  kind public.credit_txn_kind NOT NULL,
  delta int NOT NULL,
  balance_after int NOT NULL,
  reference jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credit_txn_company_idx ON public.credit_transactions(company_id, created_at DESC);
GRANT SELECT ON public.credit_transactions TO authenticated;
GRANT ALL ON public.credit_transactions TO service_role;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view txns" ON public.credit_transactions
  FOR SELECT TO authenticated
  USING (public.has_company_membership(auth.uid(), company_id));

-- 4. candidate_unlocks
CREATE TABLE public.candidate_unlocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  candidate_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  unlocked_by uuid,
  credits_spent int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, candidate_user_id)
);
CREATE INDEX candidate_unlocks_company_idx ON public.candidate_unlocks(company_id, created_at DESC);
GRANT SELECT ON public.candidate_unlocks TO authenticated;
GRANT ALL ON public.candidate_unlocks TO service_role;
ALTER TABLE public.candidate_unlocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view unlocks" ON public.candidate_unlocks
  FOR SELECT TO authenticated
  USING (public.has_company_membership(auth.uid(), company_id));

-- 5. razorpay_orders
CREATE TABLE public.razorpay_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  pack_id uuid NOT NULL REFERENCES public.credit_packs(id),
  amount_inr int NOT NULL,
  credits int NOT NULL,
  razorpay_order_id text UNIQUE,
  razorpay_payment_id text,
  status text NOT NULL DEFAULT 'created',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX razorpay_orders_company_idx ON public.razorpay_orders(company_id, created_at DESC);
GRANT SELECT ON public.razorpay_orders TO authenticated;
GRANT ALL ON public.razorpay_orders TO service_role;
ALTER TABLE public.razorpay_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view orders" ON public.razorpay_orders
  FOR SELECT TO authenticated
  USING (public.has_company_membership(auth.uid(), company_id));

CREATE TRIGGER razorpay_orders_updated_at
  BEFORE UPDATE ON public.razorpay_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 6. apply_credit_delta() — atomic wallet update + ledger insert
CREATE OR REPLACE FUNCTION public.apply_credit_delta(
  _company_id uuid,
  _delta int,
  _kind public.credit_txn_kind,
  _reference jsonb DEFAULT NULL,
  _actor uuid DEFAULT NULL
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _new_balance int;
BEGIN
  INSERT INTO public.employer_credit_wallets (company_id, balance)
    VALUES (_company_id, 0)
    ON CONFLICT (company_id) DO NOTHING;

  UPDATE public.employer_credit_wallets
    SET balance = balance + _delta, updated_at = now()
    WHERE company_id = _company_id
    RETURNING balance INTO _new_balance;

  IF _new_balance < 0 THEN
    RAISE EXCEPTION 'Insufficient credits';
  END IF;

  INSERT INTO public.credit_transactions (company_id, kind, delta, balance_after, reference, created_by)
    VALUES (_company_id, _kind, _delta, _new_balance, _reference, _actor);

  RETURN _new_balance;
END $$;

-- 7. unlock_candidate() — atomic deduct + unlock insert; idempotent per (company, candidate)
CREATE OR REPLACE FUNCTION public.unlock_candidate(
  _company_id uuid,
  _candidate_user_id uuid,
  _actor uuid DEFAULT NULL
) RETURNS TABLE (already_unlocked boolean, balance_after int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _exists boolean; _bal int;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.candidate_unlocks
                WHERE company_id = _company_id AND candidate_user_id = _candidate_user_id)
    INTO _exists;
  IF _exists THEN
    SELECT balance INTO _bal FROM public.employer_credit_wallets WHERE company_id = _company_id;
    RETURN QUERY SELECT true, COALESCE(_bal, 0);
    RETURN;
  END IF;

  _bal := public.apply_credit_delta(
    _company_id, -1, 'unlock'::public.credit_txn_kind,
    jsonb_build_object('candidate_user_id', _candidate_user_id), _actor
  );

  INSERT INTO public.candidate_unlocks (company_id, candidate_user_id, unlocked_by, credits_spent)
    VALUES (_company_id, _candidate_user_id, _actor, 1);

  RETURN QUERY SELECT false, _bal;
END $$;

-- 8. Seed credit packs
INSERT INTO public.credit_packs (name, credits, price_inr, badge, sort) VALUES
  ('Starter',     100,   999, NULL,         10),
  ('Growth',      500,  3999, 'Popular',    20),
  ('Pro',        2000, 12999, 'Best value', 30),
  ('Enterprise',10000, 49999, NULL,         40);
