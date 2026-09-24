-- Job Quality Score — makes jobs.quality_score real. The column has existed
-- since the first migration but nothing ever computed it (see
-- job-quality-score-implementation.md). This adds:
--   1) compute_job_quality(jobs) — SQL twin of src/lib/jobQuality.ts's
--      computeJobQuality(). Both implement the IDENTICAL 100-point rubric;
--      keep them in lockstep — drift between the two silently breaks trust
--      in the number shown to recruiters.
--   2) tg_jobs_quality_score — BEFORE INSERT/UPDATE trigger that persists it,
--      so it's always correct regardless of which code path wrote the row
--      (wizard, bulk upload, seed data).
--   3) tg_jobs_quality_activity — AFTER UPDATE trigger that logs
--      'job.quality_improved' to employer_activity when an edit pushes the
--      score across a label boundary (Fair -> Good, etc.), powering
--      gamification stats without a new table.
--   4) Backfill for existing rows.
-- feed_jobs() already reads quality_score via boost_settings.quality_weight
-- (see 20260924053114_job_boost_engine_ddl.sql) — this migration is what
-- makes that input non-zero.

CREATE OR REPLACE FUNCTION public.compute_job_quality(j public.jobs)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  score integer := 0;
  has_min boolean := COALESCE(j.min_salary, 0) > 0;
  has_max boolean := COALESCE(j.max_salary, 0) > 0;
  has_incentive boolean := j.pay_type = 'incentive_only' AND COALESCE(j.avg_incentive_monthly, 0) > 0;
  has_any_pay boolean := has_incentive OR has_min OR has_max;
BEGIN
  -- Core completeness (40)
  IF length(trim(COALESCE(j.title, ''))) > 0 THEN score := score + 5; END IF;
  IF length(trim(COALESCE(j.category, ''))) > 0 THEN score := score + 5; END IF;
  IF length(trim(COALESCE(j.industry, ''))) > 0 THEN score := score + 5; END IF;
  IF length(trim(COALESCE(j.city, ''))) > 0 THEN score := score + 5; END IF;
  IF length(trim(COALESCE(j.locality, ''))) > 0 THEN score := score + 5; END IF;
  IF j.job_type IS NOT NULL THEN score := score + 5; END IF;
  IF j.work_mode IS NOT NULL THEN score := score + 5; END IF;
  IF COALESCE(j.openings, 0) > 0 THEN score := score + 5; END IF;

  -- Compensation (20)
  IF has_incentive OR (has_min AND has_max) THEN score := score + 10;
  ELSIF has_any_pay THEN score := score + 5;
  END IF;
  IF has_min AND has_max AND j.max_salary >= j.min_salary * 1.2 THEN score := score + 5; END IF;
  IF length(trim(COALESCE(j.pay_type, ''))) > 0 THEN score := score + 5; END IF;

  -- Requirements (15)
  IF j.experience_bucket IS NOT NULL AND j.experience_bucket <> 'any' THEN score := score + 5; END IF;
  IF COALESCE(array_length(j.skills, 1), 0) >= 3 THEN score := score + 5; END IF;
  IF length(trim(COALESCE(j.education, ''))) > 0
     OR COALESCE(array_length(j.certifications, 1), 0) > 0
     OR COALESCE(array_length(j.preferred_languages, 1), 0) > 0 THEN
    score := score + 5;
  END IF;

  -- Description (15)
  IF length(COALESCE(j.description, '')) >= 300 THEN score := score + 5; END IF;
  IF length(trim(COALESCE(j.description_html, ''))) > 0 THEN score := score + 5; END IF;
  IF COALESCE(j.description, '') ~* '(₹|salary|incentive|ctc|per month|perks|benefit)' THEN score := score + 5; END IF;

  -- Conversion boosters (10)
  IF COALESCE(array_length(j.perks, 1), 0) >= 2 THEN score := score + 3; END IF;
  IF length(trim(COALESCE(j.interview_type, ''))) > 0 THEN score := score + 3; END IF;
  IF j.shift IS NOT NULL AND COALESCE(j.working_days, 0) > 0 THEN score := score + 2; END IF;
  IF length(trim(COALESCE(j.pincode, ''))) > 0 THEN score := score + 2; END IF;

  RETURN LEAST(score, 100);
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_jobs_quality_score()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.quality_score := public.compute_job_quality(NEW);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS jobs_quality_score ON public.jobs;
CREATE TRIGGER jobs_quality_score BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_jobs_quality_score();

-- Label boundaries mirror jobQualityLabel() in src/lib/jobQuality.ts.
CREATE OR REPLACE FUNCTION public.tg_jobs_quality_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  old_label text;
  new_label text;
BEGIN
  IF NEW.quality_score = OLD.quality_score THEN RETURN NEW; END IF;

  old_label := CASE WHEN OLD.quality_score >= 80 THEN 'Excellent' WHEN OLD.quality_score >= 60 THEN 'Good'
                     WHEN OLD.quality_score >= 40 THEN 'Fair' ELSE 'Needs work' END;
  new_label := CASE WHEN NEW.quality_score >= 80 THEN 'Excellent' WHEN NEW.quality_score >= 60 THEN 'Good'
                     WHEN NEW.quality_score >= 40 THEN 'Fair' ELSE 'Needs work' END;

  IF new_label <> old_label AND NEW.quality_score > OLD.quality_score THEN
    PERFORM public.log_employer_activity(
      NEW.company_id, NEW.posted_by, 'job.quality_improved', 'Job quality improved',
      old_label || ' → ' || new_label || ' (' || OLD.quality_score || ' → ' || NEW.quality_score || ')',
      '/employer/jobs/' || NEW.id || '/edit',
      jsonb_build_object('job_id', NEW.id, 'from_score', OLD.quality_score, 'to_score', NEW.quality_score, 'from_label', old_label, 'to_label', new_label)
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS jobs_quality_activity ON public.jobs;
CREATE TRIGGER jobs_quality_activity AFTER UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_jobs_quality_activity();

-- Backfill every existing row now that the rubric is real. Runs with the
-- activity trigger disabled — a backfill crossing a label boundary isn't a
-- recruiter "improving" their post, so it shouldn't spam employer_activity.
ALTER TABLE public.jobs DISABLE TRIGGER jobs_quality_activity;
UPDATE public.jobs SET quality_score = public.compute_job_quality(jobs.*);
ALTER TABLE public.jobs ENABLE TRIGGER jobs_quality_activity;
