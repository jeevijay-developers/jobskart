import { supabase } from "@/integrations/supabase/client";
import type { JobCardData } from "@/components/site/JobCard";

/**
 * Shared feed adapter — the one place Dashboard and `/jobs` build RPC args
 * and map rows back into JobCardData, so the two screens can never quietly
 * diverge on filters or on what "eligible" means.
 *
 * - fetchPublicJobFeed(): guest + employer "Recommended" sort only (unchanged, uses feed_jobs)
 * - fetchCandidateJobFeed(): identity-scoped, uses recommend_jobs_for_candidate
 *   (personalized scoring + applied-job exclusion as a discovery invariant)
 */

export type JobFeedSort = "recommended" | "newest" | "oldest" | "salary_high" | "salary_low";

export type JobFeedFilters = {
  q?: string;
  city?: string;
  category?: string;
  jobType?: string;
  workMode?: string;
  minSalary?: string;
  maxSalary?: string;
  minExp?: string;
  maxExp?: string;
  /** Already-resolved ISO cutoff (UI owns turning "last 7 days" etc. into a timestamp). */
  postedAfter?: string;
  education?: string;
  shift?: string;
  englishLevel?: string;
  company?: string;
  vehicle?: boolean;
  verifiedOnly?: boolean;
};

export type JobFeedResult = {
  rows: JobCardData[];
  /** Eligible-row count after exclusion/filters, before LIMIT/OFFSET. */
  total: number;
  error: string | null;
};

// The shape returned by recommend_jobs_for_candidate (extends feed_jobs_for_candidate)
type RecommendRow = {
  id: string;
  company_id: string;
  title: string;
  city: string | null;
  state: string | null;
  locality: string | null;
  min_salary: number | null;
  max_salary: number | null;
  salary_period: string | null;
  job_type: string;
  work_mode: string;
  min_experience_years: number | null;
  max_experience_years: number | null;
  education: string | null;
  skills: string[] | null;
  created_at: string;
  pay_type: string | null;
  avg_incentive_monthly: number | null;
  company_name: string | null;
  company_is_verified: boolean | null;
  boosted: boolean | null;
  score: number | null;              // NEW: personalized relevance score (0-1)
  score_breakdown: Record<string, any> | null;  // NEW: explainable scoring breakdown
  total_count: number | string;
};

function mapRecommendRows(rows: RecommendRow[]): JobCardData[] {
  return rows.map((r) => ({
    id: r.id,
    company_id: r.company_id,
    title: r.title,
    city: r.city,
    state: r.state,
    locality: r.locality,
    min_salary: r.min_salary,
    max_salary: r.max_salary,
    salary_period: r.salary_period,
    job_type: r.job_type,
    work_mode: r.work_mode,
    min_experience_years: r.min_experience_years,
    max_experience_years: r.max_experience_years,
    education: r.education,
    skills: r.skills,
    created_at: r.created_at,
    pay_type: r.pay_type,
    avg_incentive_monthly: r.avg_incentive_monthly,
    companies: { name: r.company_name ?? "", is_verified: r.company_is_verified },
    boosted: r.boosted ?? false,
    // NEW: attach score for UI indicators (e.g., "95% match")
    relevance_score: r.score,
    score_breakdown: r.score_breakdown,
  }));
}

function recommendTotal(rows: RecommendRow[]): number {
  return rows.length > 0 ? Number(rows[0].total_count) : 0;
}

function baseRpcArgs(filters: JobFeedFilters, from: number, to: number) {
  return {
    _q: filters.q || undefined,
    _city: filters.city || undefined,
    _category: filters.category || undefined,
    _job_type: filters.jobType || undefined,
    _work_mode: filters.workMode || undefined,
    _min_salary: filters.minSalary ? Number(filters.minSalary) : undefined,
    _max_salary: filters.maxSalary ? Number(filters.maxSalary) : undefined,
    _min_exp: filters.minExp ? Number(filters.minExp) : undefined,
    _max_exp: filters.maxExp ? Number(filters.maxExp) : undefined,
    _posted_after: filters.postedAfter || undefined,
    _education: filters.education || undefined,
    _shift: filters.shift || undefined,
    _english_level: filters.englishLevel || undefined,
    _company: filters.company || undefined,
    _vehicle: !!filters.vehicle,
    _verified_only: !!filters.verifiedOnly,
    _limit: to - from + 1,
    _offset: from,
  };
}

/** Public feed (feed_jobs): guest + employer "Recommended" sort only, unchanged. */
export async function fetchPublicJobFeed(
  filters: JobFeedFilters,
  from: number,
  to: number,
): Promise<JobFeedResult> {
  const { data, error } = await supabase.rpc("feed_jobs", baseRpcArgs(filters, from, to));
  if (error) return { rows: [], total: 0, error: error.message };
  const rows = (data ?? []) as RecommendRow[];
  return { rows: mapRecommendRows(rows), total: recommendTotal(rows), error: null };
}

/**
 * Candidate feed (recommend_jobs_for_candidate): identity comes from auth.uid()
 * server-side. Returns personalized relevance scores with explainable breakdown.
 * Applied-job exclusion is a discovery invariant (not just for "recommended" sort).
 * The `sort` parameter is now ignored — results are always ranked by personalized score.
 */
export async function fetchCandidateJobFeed(
  filters: JobFeedFilters,
  _sort: JobFeedSort,  // kept for API compatibility; ignored by new RPC
  from: number,
  to: number,
): Promise<JobFeedResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase.rpc("recommend_jobs_for_candidate" as any, 
    baseRpcArgs(filters, from, to)
  );
  if (error) return { rows: [], total: 0, error: error.message };
  const rows = (data ?? []) as unknown as RecommendRow[];
  return { rows: mapRecommendRows(rows), total: recommendTotal(rows), error: null };
}
