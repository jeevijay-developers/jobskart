// Job posting quality rubric — pure TS, no I/O. Mirrors the shape of
// profileStrength.ts (computeX / xLabel / getMissingX) so the UI pattern is
// identical on both the candidate and employer sides.
//
// This is the single source of truth for the 100-point rubric. The Postgres
// function `compute_job_quality` (supabase/migrations/<ts>_job_quality_score.sql)
// implements the exact same checks so the DB-persisted jobs.quality_score
// never drifts from what this module reports live in the wizard — see that
// migration's header comment for the parity note.
export type JobQualityInput = {
  title?: string | null;
  category?: string | null;
  industry?: string | null;
  city?: string | null;
  locality?: string | null;
  job_type?: string | null;
  work_mode?: string | null;
  openings?: number | null;
  pay_type?: string | null;
  min_salary?: number | null;
  max_salary?: number | null;
  avg_incentive_monthly?: number | null;
  experience_bucket?: string | null;
  skills?: string[] | null;
  education?: string | null;
  certifications?: string[] | null;
  preferred_languages?: string[] | null;
  description?: string | null;
  description_html?: string | null;
  perks?: string[] | null;
  interview_type?: string | null;
  shift?: string | null;
  working_days?: number | null;
  pincode?: string | null;
};

function hasText(s?: string | null): boolean {
  return Boolean(s && s.trim().length > 0);
}

function hasPay(i: JobQualityInput): boolean {
  if (i.pay_type === "incentive_only" && (i.avg_incentive_monthly ?? 0) > 0) return true;
  return (i.min_salary ?? 0) > 0 || (i.max_salary ?? 0) > 0;
}

const SALARY_MENTION_RE = /(₹|salary|incentive|ctc|per month|perks|benefit)/i;

export function computeJobQuality(i: JobQualityInput): number {
  let score = 0;

  // Core completeness (40)
  if (hasText(i.title)) score += 5;
  if (hasText(i.category)) score += 5;
  if (hasText(i.industry)) score += 5;
  if (hasText(i.city)) score += 5;
  if (hasText(i.locality)) score += 5;
  if (hasText(i.job_type)) score += 5;
  if (hasText(i.work_mode)) score += 5;
  if ((i.openings ?? 0) > 0) score += 5;

  // Compensation (20)
  const min = (i.min_salary ?? 0) > 0;
  const max = (i.max_salary ?? 0) > 0;
  if ((i.pay_type === "incentive_only" && (i.avg_incentive_monthly ?? 0) > 0) || (min && max))
    score += 10;
  else if (hasPay(i)) score += 5;
  if (min && max && (i.max_salary as number) >= (i.min_salary as number) * 1.2) score += 5;
  if (hasText(i.pay_type)) score += 5;

  // Requirements (15)
  if (hasText(i.experience_bucket) && i.experience_bucket !== "any") score += 5;
  if ((i.skills?.length ?? 0) >= 3) score += 5;
  if (
    hasText(i.education) ||
    (i.certifications?.length ?? 0) > 0 ||
    (i.preferred_languages?.length ?? 0) > 0
  )
    score += 5;

  // Description (15)
  if ((i.description?.length ?? 0) >= 300) score += 5;
  if (hasText(i.description_html)) score += 5;
  if (SALARY_MENTION_RE.test(i.description ?? "")) score += 5;

  // Conversion boosters (10)
  if ((i.perks?.length ?? 0) >= 2) score += 3;
  if (hasText(i.interview_type)) score += 3;
  if (hasText(i.shift) && (i.working_days ?? 0) > 0) score += 2;
  if (hasText(i.pincode)) score += 2;

  return Math.min(score, 100);
}

export function jobQualityLabel(score: number): { label: string; color: string } {
  if (score >= 80) return { label: "Excellent", color: "text-success" };
  if (score >= 60) return { label: "Good", color: "text-primary" };
  if (score >= 40) return { label: "Fair", color: "text-amber-600" };
  return { label: "Needs work", color: "text-destructive" };
}

export type JobQualityGap = { key: string; step: 0 | 1 | 2 | 3; label: string; points: number };

/**
 * Same checks as computeJobQuality, but reports which specific ones are
 * failing, each tagged with the wizard step (0=Basics, 1=Location & Pay,
 * 2=Requirements, 3=Description) whose fields fix it, and sorted by points
 * descending so the UI can show "biggest wins first".
 */
export function getMissingJobImprovements(i: JobQualityInput): JobQualityGap[] {
  const out: JobQualityGap[] = [];
  const min = (i.min_salary ?? 0) > 0;
  const max = (i.max_salary ?? 0) > 0;

  if (!hasText(i.title)) out.push({ key: "title", step: 0, label: "Add a job title", points: 5 });
  if (!hasText(i.category))
    out.push({ key: "category", step: 0, label: "Pick a category", points: 5 });
  if (!hasText(i.industry))
    out.push({ key: "industry", step: 0, label: "Pick an industry", points: 5 });
  if (!hasText(i.job_type))
    out.push({ key: "job_type", step: 0, label: "Select a job type", points: 5 });
  if (!hasText(i.work_mode))
    out.push({ key: "work_mode", step: 0, label: "Select a work mode", points: 5 });
  if (!((i.openings ?? 0) > 0))
    out.push({ key: "openings", step: 0, label: "Set the number of openings", points: 5 });

  if (!hasText(i.city)) out.push({ key: "city", step: 1, label: "Pick a city", points: 5 });
  if (!hasText(i.locality))
    out.push({ key: "locality", step: 1, label: "Add the locality", points: 5 });
  if (!hasText(i.pincode))
    out.push({ key: "pincode", step: 1, label: "Add the pincode", points: 2 });
  if (!hasText(i.pay_type))
    out.push({ key: "pay_type", step: 1, label: "Select a pay type", points: 5 });

  const payFull =
    (i.pay_type === "incentive_only" && (i.avg_incentive_monthly ?? 0) > 0) || (min && max);
  if (!payFull) {
    out.push({
      key: "pay",
      step: 1,
      label: hasPay(i)
        ? "Add a maximum salary — jobs with a range get more applies"
        : "Add pay so candidates know what this role earns",
      points: hasPay(i) ? 5 : 10,
    });
  } else if (!(min && max && (i.max_salary as number) >= (i.min_salary as number) * 1.2)) {
    out.push({
      key: "pay_range",
      step: 1,
      label: "Widen the salary range a little — it reads as more credible",
      points: 5,
    });
  }

  if (!hasText(i.experience_bucket) || i.experience_bucket === "any") {
    out.push({
      key: "experience_bucket",
      step: 2,
      label: "Set an experience requirement",
      points: 5,
    });
  }
  if ((i.skills?.length ?? 0) < 3)
    out.push({ key: "skills", step: 2, label: "Add at least 3 skills", points: 5 });
  if (
    !hasText(i.education) &&
    (i.certifications?.length ?? 0) === 0 &&
    (i.preferred_languages?.length ?? 0) === 0
  ) {
    out.push({
      key: "qualifications",
      step: 2,
      label: "Add education, certifications, or a preferred language",
      points: 5,
    });
  }
  if ((i.perks?.length ?? 0) < 2)
    out.push({ key: "perks", step: 2, label: "Add at least 2 perks", points: 3 });
  if (!hasText(i.interview_type))
    out.push({ key: "interview_type", step: 2, label: "Select an interview type", points: 3 });
  if (!(hasText(i.shift) && (i.working_days ?? 0) > 0)) {
    out.push({ key: "shift", step: 2, label: "Set the shift and working days", points: 2 });
  }

  if ((i.description?.length ?? 0) < 300)
    out.push({
      key: "description_length",
      step: 3,
      label: "Write a fuller job description (300+ characters)",
      points: 5,
    });
  if (!hasText(i.description_html))
    out.push({
      key: "description_html",
      step: 3,
      label: "Generate the formatted job description",
      points: 5,
    });
  if (!SALARY_MENTION_RE.test(i.description ?? ""))
    out.push({
      key: "description_pay_mention",
      step: 3,
      label: "Mention pay or perks in the description",
      points: 5,
    });

  return out.sort((a, b) => b.points - a.points);
}
