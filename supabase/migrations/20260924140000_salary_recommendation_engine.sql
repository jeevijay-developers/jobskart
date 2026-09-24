-- Smart Salary Recommendation Engine (see salary-recommendation-engine-implementation.md).
-- Adds:
--   1) salary_bands — master table of market pay bands per normalized title ×
--      city, curated by admins (source='admin') or aggregated from platform
--      data (source='computed').
--   2) get_salary_suggestion() — read-only SECURITY DEFINER fallback ladder:
--      computed city band → admin city band → same-state band → national band
--      → category band → NULL. Never fabricates a number.
--   3) refresh_computed_salary_bands() — super-admin-only recompute of
--      computed bands from the trailing 6 months of real job postings
--      (min sample size 5). Triggered from the admin Masters panel.
--   4) log_salary_event() — adoption telemetry (shown/applied) into
--      employer_activity, membership-checked (rule 6).
-- Deviations from the plan doc:
--   - "nearest metro" fallback step is replaced by the same-state step (no
--     metro mapping table exists; state covers the intent).
--   - Demand-side signal (applications.expected_salary) deferred — computed
--     bands aggregate posted jobs only, keeping the function auditable.
--   - AI fallback deferred as planned.

CREATE TABLE IF NOT EXISTS public.salary_bands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_key text NOT NULL,
  category text,
  city text,
  state text,
  experience_bucket text NOT NULL DEFAULT 'any',
  pay_type text NOT NULL DEFAULT 'any',
  min_salary numeric NOT NULL,
  p25 numeric NOT NULL,
  median_salary numeric NOT NULL,
  p75 numeric NOT NULL,
  max_salary numeric NOT NULL,
  sample_count integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'computed')),
  is_active boolean NOT NULL DEFAULT true,
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_salary_bands
  ON public.salary_bands (title_key, COALESCE(city, ''), COALESCE(state, ''), experience_bucket, pay_type, source);
CREATE INDEX IF NOT EXISTS ix_salary_bands_lookup
  ON public.salary_bands (title_key, lower(COALESCE(city, '')));

DROP TRIGGER IF EXISTS trg_salary_bands_updated ON public.salary_bands;
CREATE TRIGGER trg_salary_bands_updated BEFORE UPDATE ON public.salary_bands
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.salary_bands TO authenticated;
GRANT ALL ON public.salary_bands TO service_role;

ALTER TABLE public.salary_bands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "salary_bands read" ON public.salary_bands;
CREATE POLICY "salary_bands read" ON public.salary_bands FOR SELECT TO authenticated
  USING (is_active OR public.has_platform_role(auth.uid(), 'super_admin'));
DROP POLICY IF EXISTS "salary_bands admin manage" ON public.salary_bands;
CREATE POLICY "salary_bands admin manage" ON public.salary_bands FOR ALL TO authenticated
  USING (public.has_platform_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_platform_role(auth.uid(), 'super_admin'));

-- ---------------------------------------------------------------------------
-- get_salary_suggestion — the fallback ladder. Returns NULL (never a guess)
-- when nothing matches. Free-text titles are normalized with slugify() and,
-- on a miss, fuzzy-matched against job_titles_master so "delivery boy" and
-- "Delivery Executive" resolve to the same key.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_salary_suggestion(
  _title text,
  _category text DEFAULT NULL,
  _city text DEFAULT NULL,
  _experience_bucket text DEFAULT 'any',
  _pay_type text DEFAULT 'fixed'
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _key text;
  _alt_key text;
  _state text;
  _city_l text;
  _b salary_bands;
  _scope text;
  -- Explicit hit flag: PL/pgSQL's FOUND would still carry the result of the
  -- fuzzy-title lookup above, silently skipping the later fallback steps.
  _hit boolean := false;
BEGIN
  IF _title IS NULL OR length(trim(_title)) < 2 THEN RETURN NULL; END IF;
  _key := public.slugify(lower(trim(_title)));
  _city_l := lower(trim(COALESCE(_city, '')));
  _experience_bucket := COALESCE(NULLIF(trim(_experience_bucket), ''), 'any');
  _pay_type := COALESCE(NULLIF(trim(_pay_type), ''), 'fixed');

  IF _city_l <> '' THEN
    SELECT c.state INTO _state FROM public.cities c
    WHERE lower(c.name) = _city_l AND c.is_launched IS NOT FALSE
    LIMIT 1;
    IF _state IS NULL THEN
      SELECT c.state INTO _state FROM public.cities c WHERE lower(c.name) = _city_l LIMIT 1;
    END IF;
  END IF;

  SELECT public.slugify(lower(trim(t.title))) INTO _alt_key
  FROM public.job_titles_master t
  WHERE t.is_active
    AND (lower(t.title) LIKE '%' || lower(trim(_title)) || '%'
         OR lower(trim(_title)) LIKE '%' || lower(t.title) || '%')
    AND public.slugify(lower(trim(t.title))) <> _key
  ORDER BY length(t.title)
  LIMIT 1;

  -- 1) computed band for this city
  IF _city_l <> '' THEN
    SELECT * INTO _b FROM public.salary_bands b
    WHERE b.is_active AND b.source = 'computed'
      AND b.title_key IN (_key, _alt_key)
      AND lower(b.city) = _city_l
      AND b.experience_bucket IN (_experience_bucket, 'any')
      AND b.pay_type IN (_pay_type, 'any')
      AND b.sample_count >= 5
      AND (b.valid_until IS NULL OR b.valid_until > now())
    ORDER BY (b.experience_bucket = _experience_bucket) DESC, b.sample_count DESC
    LIMIT 1;
    IF FOUND THEN _hit := true; _scope := 'computed_city'; END IF;
  END IF;

  -- 2) admin band for this city
  IF NOT _hit AND _city_l <> '' THEN
    SELECT * INTO _b FROM public.salary_bands b
    WHERE b.is_active AND b.source = 'admin'
      AND b.title_key IN (_key, _alt_key)
      AND lower(b.city) = _city_l
      AND b.experience_bucket IN (_experience_bucket, 'any')
      AND b.pay_type IN (_pay_type, 'any')
    ORDER BY (b.experience_bucket = _experience_bucket) DESC, b.sample_count DESC
    LIMIT 1;
    IF FOUND THEN _hit := true; _scope := 'admin_city'; END IF;
  END IF;

  -- 3) same state, any city
  IF NOT _hit AND _state IS NOT NULL THEN
    SELECT * INTO _b FROM public.salary_bands b
    WHERE b.is_active
      AND b.title_key IN (_key, _alt_key)
      AND (lower(COALESCE(b.state, '')) = lower(_state)
           OR b.city IN (SELECT c2.name FROM public.cities c2 WHERE c2.state = _state))
      AND b.experience_bucket IN (_experience_bucket, 'any')
      AND b.pay_type IN (_pay_type, 'any')
      AND (b.valid_until IS NULL OR b.valid_until > now())
    ORDER BY (b.source = 'computed') DESC, b.sample_count DESC
    LIMIT 1;
    IF FOUND THEN _hit := true; _scope := 'state'; END IF;
  END IF;

  -- 4) national band (no city/state)
  IF NOT _hit THEN
    SELECT * INTO _b FROM public.salary_bands b
    WHERE b.is_active
      AND b.title_key IN (_key, _alt_key)
      AND b.city IS NULL AND b.state IS NULL
      AND b.experience_bucket IN (_experience_bucket, 'any')
      AND b.pay_type IN (_pay_type, 'any')
      AND (b.valid_until IS NULL OR b.valid_until > now())
    ORDER BY (b.source = 'computed') DESC, b.sample_count DESC
    LIMIT 1;
    IF FOUND THEN _hit := true; _scope := 'national'; END IF;
  END IF;

  -- 5) category band for this city
  IF NOT _hit AND _category IS NOT NULL AND _city_l <> '' THEN
    SELECT * INTO _b FROM public.salary_bands b
    WHERE b.is_active
      AND lower(b.category) = lower(trim(_category))
      AND lower(b.city) = _city_l
      AND (b.valid_until IS NULL OR b.valid_until > now())
    ORDER BY b.sample_count DESC
    LIMIT 1;
    IF FOUND THEN _hit := true; _scope := 'category_city'; END IF;
  END IF;

  IF NOT _hit THEN RETURN NULL; END IF;

  RETURN jsonb_build_object(
    'min', _b.min_salary, 'p25', _b.p25, 'median', _b.median_salary,
    'p75', _b.p75, 'max', _b.max_salary,
    'sample_count', _b.sample_count, 'source', _b.source,
    'confidence', CASE WHEN _b.source = 'computed' AND _b.sample_count >= 20 THEN 'high' ELSE 'medium' END,
    'scope', _scope, 'title_key', _b.title_key
  );
END $$;

REVOKE ALL ON FUNCTION public.get_salary_suggestion(text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_salary_suggestion(text, text, text, text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- refresh_computed_salary_bands — admin-triggered (Masters panel button).
-- DELETE + INSERT keeps stale keys from lingering; computed bands carry a
-- 30-day valid_until staleness guard on top.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_computed_salary_bands()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _n integer;
BEGIN
  IF NOT public.has_platform_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  DELETE FROM public.salary_bands WHERE source = 'computed';

  WITH agg AS (
    SELECT
      public.slugify(lower(trim(j.title))) AS title_key,
      trim(j.city) AS city,
      count(*)::integer AS n,
      percentile_cont(0.10) WITHIN GROUP (ORDER BY j.min_salary) AS lo,
      percentile_cont(0.25) WITHIN GROUP (ORDER BY (j.min_salary + j.max_salary) / 2.0) AS p25,
      percentile_cont(0.50) WITHIN GROUP (ORDER BY (j.min_salary + j.max_salary) / 2.0) AS med,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY (j.min_salary + j.max_salary) / 2.0) AS p75,
      percentile_cont(0.90) WITHIN GROUP (ORDER BY j.max_salary) AS hi
    FROM public.jobs j
    WHERE j.status IN ('active', 'closed', 'expired')
      AND j.created_at >= now() - interval '180 days'
      AND COALESCE(j.min_salary, 0) > 0
      AND COALESCE(j.max_salary, 0) > 0
      AND j.city IS NOT NULL AND length(trim(j.city)) > 0
    GROUP BY 1, 2
    HAVING count(*) >= 5
  )
  INSERT INTO public.salary_bands
    (title_key, city, experience_bucket, pay_type,
     min_salary, p25, median_salary, p75, max_salary, sample_count, source, valid_until)
  SELECT
    agg.title_key, agg.city, 'any', 'any',
    round(agg.lo / 100) * 100, round(agg.p25 / 100) * 100, round(agg.med / 100) * 100,
    round(agg.p75 / 100) * 100, round(agg.hi / 100) * 100,
    agg.n, 'computed', now() + interval '30 days'
  FROM agg;

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

REVOKE ALL ON FUNCTION public.refresh_computed_salary_bands() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_computed_salary_bands() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- log_salary_event — adoption telemetry. log_employer_activity is revoked
-- from authenticated, so this membership-checked wrapper is the only door.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_salary_event(
  _company_id uuid,
  _kind text,
  _meta jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _kind NOT IN ('salary_suggestion_shown', 'salary_suggestion_applied') THEN
    RAISE EXCEPTION 'invalid_kind';
  END IF;
  IF NOT public.has_company_membership(auth.uid(), _company_id) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;
  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), _kind, 'Salary suggestion',
    COALESCE(_meta ->> 'title', ''), '/employer/jobs/new', _meta
  );
END $$;

REVOKE ALL ON FUNCTION public.log_salary_event(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_salary_event(uuid, text, jsonb) TO authenticated, service_role;
