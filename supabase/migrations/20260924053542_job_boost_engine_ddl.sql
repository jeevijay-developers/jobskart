-- Boost Job feature — tables, cache trigger, and RPCs.
-- See 20260924052742_job_boost_engine.sql for the 'boost' credit_txn_kind
-- value this depends on, and its header comment for deviations from the
-- plan doc (boost_day column instead of a timezone() expression index,
-- feed_jobs as SECURITY DEFINER, no trending_bonus/match_scoring_config yet,
-- "Boosted" badge instead of "Featured").

-- 1) job_boosts — one row per boost purchase. boost_day is a plain stored
--    column (not a generated column) precisely so the uniqueness constraint
--    below can be a normal btree index, not an expression index — Postgres
--    requires expression-index functions to be IMMUTABLE and timezone() is
--    only STABLE.
CREATE TABLE IF NOT EXISTS public.job_boosts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  boost_day date NOT NULL DEFAULT (timezone('Asia/Kolkata', now()))::date,
  credits_spent int NOT NULL CHECK (credits_spent > 0),
  boosted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS job_boosts_one_per_day_idx ON public.job_boosts(job_id, boost_day);
CREATE INDEX IF NOT EXISTS job_boosts_company_idx ON public.job_boosts(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS job_boosts_ends_at_idx ON public.job_boosts(ends_at);
CREATE INDEX IF NOT EXISTS job_boosts_job_idx ON public.job_boosts(job_id, created_at DESC);

GRANT SELECT ON public.job_boosts TO authenticated;
GRANT ALL ON public.job_boosts TO service_role;
ALTER TABLE public.job_boosts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members can view their company's boosts" ON public.job_boosts;
CREATE POLICY "Members can view their company's boosts" ON public.job_boosts
  FOR SELECT TO authenticated
  USING (public.has_company_membership(auth.uid(), company_id));

-- 2) boost_settings — singleton, admin-editable economics (rule: no code
--    deploy to retune pricing). freshness_weight/quality_weight live here
--    too (not in a match_scoring_config table, which doesn't exist in this
--    codebase) since they're boost-formula tunables, not candidate-match ones.
CREATE TABLE IF NOT EXISTS public.boost_settings (
  id int PRIMARY KEY DEFAULT 1,
  cost_credits int NOT NULL DEFAULT 1 CHECK (cost_credits > 0),
  window_hours int NOT NULL DEFAULT 24 CHECK (window_hours > 0),
  boost_weight numeric NOT NULL DEFAULT 40,
  freshness_weight numeric NOT NULL DEFAULT 20,
  quality_weight numeric NOT NULL DEFAULT 10,
  max_boosts_per_company_day int NOT NULL DEFAULT 10 CHECK (max_boosts_per_company_day > 0),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT boost_settings_singleton CHECK (id = 1)
);
INSERT INTO public.boost_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

GRANT SELECT ON public.boost_settings TO anon, authenticated;
GRANT ALL ON public.boost_settings TO service_role;
ALTER TABLE public.boost_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read boost settings" ON public.boost_settings;
CREATE POLICY "Anyone can read boost settings" ON public.boost_settings
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "Super admins manage boost settings" ON public.boost_settings;
CREATE POLICY "Super admins manage boost settings" ON public.boost_settings
  FOR UPDATE TO authenticated
  USING (public.has_platform_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_platform_role(auth.uid(), 'super_admin'));

DROP TRIGGER IF EXISTS boost_settings_set_updated_at ON public.boost_settings;
CREATE TRIGGER boost_settings_set_updated_at BEFORE UPDATE ON public.boost_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 3) Cache maintenance — jobs.boosted_until is a denormalized "latest boost
--    end" used only for cheap badge/filter reads, never for correctness of
--    expiry (feed_jobs always re-checks ends_at > now() at query time).
CREATE OR REPLACE FUNCTION public.tg_job_boosts_maintain_cache()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.jobs
    SET boosted_until = GREATEST(COALESCE(boosted_until, NEW.ends_at), NEW.ends_at)
    WHERE id = NEW.job_id;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS job_boosts_maintain_cache ON public.job_boosts;
CREATE TRIGGER job_boosts_maintain_cache AFTER INSERT ON public.job_boosts
  FOR EACH ROW EXECUTE FUNCTION public.tg_job_boosts_maintain_cache();

-- 4) apply_boost() — the one place money + access logic for boosting lives.
--    SECURITY DEFINER, row-locks the job so two concurrent calls on the same
--    job can't both pass the "no boost today" check before either commits;
--    apply_credit_delta() row-locks the wallet on top of that.
CREATE OR REPLACE FUNCTION public.apply_boost(_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _company_id uuid;
  _status public.job_status;
  _created_at timestamptz;
  _title text;
  _settings RECORD;
  _boosts_today int;
  _balance int;
  _ends_at timestamptz;
  _boost_id uuid;
BEGIN
  SELECT company_id, status, created_at, title INTO _company_id, _status, _created_at, _title
  FROM public.jobs WHERE id = _job_id;

  IF _company_id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  IF NOT public.has_company_membership(auth.uid(), _company_id) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  IF _status <> 'active' THEN
    RAISE EXCEPTION 'job_not_active';
  END IF;

  SELECT * INTO _settings FROM public.boost_settings WHERE id = 1;
  IF _settings IS NULL OR NOT _settings.enabled THEN
    RAISE EXCEPTION 'boost_disabled';
  END IF;

  -- Same Day Restriction: a job can't be boosted on the day it goes live —
  -- freshness_bonus already outranks a full boost_bonus on day 0 (see
  -- feed_jobs), so this is belt-and-suspenders honesty, not the only guard.
  IF (timezone('Asia/Kolkata', _created_at))::date = (timezone('Asia/Kolkata', now()))::date THEN
    RAISE EXCEPTION 'boost_same_day';
  END IF;

  -- Lock the job row so a concurrent apply_boost() on the SAME job serializes
  -- behind this one before either re-checks job_boosts for today.
  PERFORM 1 FROM public.jobs WHERE id = _job_id FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.job_boosts
    WHERE job_id = _job_id AND boost_day = (timezone('Asia/Kolkata', now()))::date
  ) THEN
    RAISE EXCEPTION 'boost_same_day';
  END IF;

  SELECT count(*) INTO _boosts_today FROM public.job_boosts
  WHERE company_id = _company_id AND boost_day = (timezone('Asia/Kolkata', now()))::date;
  IF _boosts_today >= _settings.max_boosts_per_company_day THEN
    RAISE EXCEPTION 'boost_daily_cap';
  END IF;

  _ends_at := now() + (_settings.window_hours::text || ' hours')::interval;

  BEGIN
    _balance := public.apply_credit_delta(
      _company_id, -_settings.cost_credits, 'boost'::public.credit_txn_kind,
      jsonb_build_object('job_id', _job_id), auth.uid()
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'Insufficient credits%' THEN
      RAISE EXCEPTION 'no_credits';
    END IF;
    RAISE;
  END;

  INSERT INTO public.job_boosts (company_id, job_id, ends_at, credits_spent, boosted_by)
    VALUES (_company_id, _job_id, _ends_at, _settings.cost_credits, auth.uid())
    RETURNING id INTO _boost_id;

  PERFORM public.log_employer_activity(
    _company_id, auth.uid(), 'job.boosted', 'Job boosted',
    _title, '/employer/jobs',
    jsonb_build_object('job_id', _job_id, 'boost_id', _boost_id, 'ends_at', _ends_at, 'credits_spent', _settings.cost_credits)
  );

  RETURN jsonb_build_object(
    'boost_id', _boost_id, 'ends_at', _ends_at,
    'credits_spent', _settings.cost_credits, 'balance_after', _balance
  );
END $$;

REVOKE ALL ON FUNCTION public.apply_boost(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_boost(uuid) TO authenticated;

-- 5) credits_activity trigger: give 'boost' its own label instead of falling
--    through to the generic "Credit adjustment" ELSE branch.
CREATE OR REPLACE FUNCTION public.tg_credits_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.log_employer_activity(
    NEW.company_id, NEW.created_by,
    CASE NEW.kind::text WHEN 'purchase' THEN 'credits.purchased'
                       WHEN 'unlock'   THEN 'credits.spent'
                       WHEN 'grant'    THEN 'credits.granted'
                       WHEN 'boost'    THEN 'credits.spent'
                       ELSE 'credits.adjusted' END,
    CASE NEW.kind::text WHEN 'purchase' THEN 'Credits purchased'
                       WHEN 'unlock'   THEN 'Credit spent on unlock'
                       WHEN 'grant'    THEN 'Credits granted'
                       WHEN 'boost'    THEN 'Credits spent on boost'
                       ELSE 'Credit adjustment' END,
    (CASE WHEN NEW.delta > 0 THEN '+' ELSE '' END) || NEW.delta::text || ' credits · balance ' || NEW.balance_after::text,
    '/employer/credits',
    jsonb_build_object('delta', NEW.delta, 'kind', NEW.kind, 'reference', NEW.reference)
  );
  RETURN NEW;
END $$;

-- 6) feed_jobs() — the server-side "Recommended" ranking for the public
--    candidate feed. SECURITY DEFINER (see file header): it needs
--    job_boosts.ends_at for every job regardless of who's asking, and
--    job_boosts RLS only exposes a company's own boosts to that company.
--    Everything it SELECTs back out is already public (active jobs, public
--    companies, and a computed score) — it never returns credits_spent or
--    any other job_boosts column.
--
--    Formula: score = boost_bonus + freshness_bonus + quality_bonus.
--    trending_bonus is omitted — jobs.tier doesn't exist in this schema yet
--    (see file header). Explicit sorts (salary/oldest) never call this
--    function at all; they stay as the existing plain client queries in
--    src/routes/jobs.tsx, so a paid boost can never override an explicit
--    candidate sort.
CREATE OR REPLACE FUNCTION public.feed_jobs(
  _q text DEFAULT NULL,
  _city text DEFAULT NULL,
  _category text DEFAULT NULL,
  _job_type text DEFAULT NULL,
  _work_mode text DEFAULT NULL,
  _min_salary int DEFAULT NULL,
  _max_salary int DEFAULT NULL,
  _min_exp int DEFAULT NULL,
  _max_exp int DEFAULT NULL,
  _posted_after timestamptz DEFAULT NULL,
  _education text DEFAULT NULL,
  _shift text DEFAULT NULL,
  _english_level text DEFAULT NULL,
  _company text DEFAULT NULL,
  _vehicle boolean DEFAULT false,
  _verified_only boolean DEFAULT false,
  _limit int DEFAULT 50,
  _offset int DEFAULT 0
) RETURNS TABLE (
  id uuid,
  company_id uuid,
  title text,
  city text,
  state text,
  locality text,
  min_salary integer,
  max_salary integer,
  salary_period text,
  job_type text,
  work_mode text,
  min_experience_years integer,
  max_experience_years integer,
  education text,
  skills text[],
  created_at timestamptz,
  pay_type text,
  avg_incentive_monthly integer,
  company_name text,
  company_is_verified boolean,
  boosted boolean,
  score numeric,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH s AS (SELECT * FROM public.boost_settings WHERE id = 1),
  scored AS (
    SELECT
      j.id, j.company_id, j.title, j.city, j.state, j.locality,
      j.min_salary, j.max_salary, j.salary_period, j.job_type, j.work_mode,
      j.min_experience_years, j.max_experience_years, j.education, j.skills,
      j.created_at, j.pay_type, j.avg_incentive_monthly,
      c.name AS company_name, c.is_verified AS company_is_verified,
      lb.ends_at AS boost_ends_at,
      (
        CASE WHEN lb.ends_at IS NOT NULL AND lb.ends_at > now()
          THEN s.boost_weight * (
            extract(epoch FROM (lb.ends_at - now()))
            / GREATEST(extract(epoch FROM (lb.ends_at - lb.starts_at)), 1)
          )
          ELSE 0 END
        + s.freshness_weight * GREATEST(0, 1 - (extract(epoch FROM (now() - j.created_at)) / 86400.0) / 7)
        + s.quality_weight * (COALESCE(j.quality_score, 0) / 100.0)
      ) AS score
    FROM public.jobs j
    JOIN public.companies c ON c.id = j.company_id
    CROSS JOIN s
    LEFT JOIN LATERAL (
      SELECT jb.ends_at, jb.starts_at FROM public.job_boosts jb
      WHERE jb.job_id = j.id AND jb.ends_at > now()
      ORDER BY jb.ends_at DESC LIMIT 1
    ) lb ON true
    WHERE j.status = 'active'
      AND (_q IS NULL OR j.title ILIKE '%' || _q || '%')
      AND (_city IS NULL OR j.city ILIKE '%' || _city || '%')
      AND (_category IS NULL OR j.category = _category)
      AND (_job_type IS NULL OR j.job_type::text = _job_type)
      AND (_work_mode IS NULL OR j.work_mode::text = _work_mode)
      AND (_min_salary IS NULL OR j.min_salary >= _min_salary)
      AND (_max_salary IS NULL OR j.max_salary <= _max_salary)
      -- Job's accepted experience range must overlap the candidate's selected range (mirrors src/routes/jobs.tsx runQuery).
      AND (_max_exp IS NULL OR j.min_experience_years <= _max_exp)
      AND (_min_exp IS NULL OR j.max_experience_years >= _min_exp OR j.max_experience_years IS NULL)
      AND (_posted_after IS NULL OR j.created_at >= _posted_after)
      AND (_education IS NULL OR j.education = _education)
      AND (_shift IS NULL OR j.shift::text = _shift)
      AND (_english_level IS NULL OR j.english_level = _english_level)
      AND (_company IS NULL OR c.name ILIKE '%' || _company || '%')
      AND (_vehicle IS NOT TRUE OR j.required_assets @> ARRAY['Two-wheeler'])
      AND (_verified_only IS NOT TRUE OR c.is_verified = true)
  )
  SELECT
    id, company_id, title, city, state, locality, min_salary, max_salary, salary_period,
    job_type, work_mode, min_experience_years, max_experience_years, education, skills,
    created_at, pay_type, avg_incentive_monthly, company_name, company_is_verified,
    (boost_ends_at IS NOT NULL) AS boosted,
    score,
    count(*) OVER() AS total_count
  FROM scored
  ORDER BY score DESC, created_at DESC
  LIMIT _limit OFFSET _offset;
$$;

REVOKE ALL ON FUNCTION public.feed_jobs(
  text, text, text, text, text, int, int, int, int, timestamptz, text, text, text, text, boolean, boolean, int, int
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.feed_jobs(
  text, text, text, text, text, int, int, int, int, timestamptz, text, text, text, text, boolean, boolean, int, int
) TO anon, authenticated;
