import { supabase } from "@/integrations/supabase/client";
import type { JobCardData } from "@/components/site/JobCard";

// Shared feed adapter (see applied-jobs-discovery-feed-implementation.md):
// the one place Dashboard and `/jobs` build feed_jobs*() RPC args and map
// rows back into JobCardData, so the two screens can never quietly diverge
// on filters or on what "eligible" means.
//
// fetchPublicJobFeed() is the existing public contract (feed_jobs, guest +
// employer "Recommended" only — unchanged). fetchCandidateJobFeed() is the
// new identity-scoped contract (feed_jobs_for_candidate) that every signed-in
// candidate sort on `/jobs`, plus the Dashboard, should use instead — it
// excludes the candidate's own applied job IDs before ranking, count, and
// pagination. Guests/employers never call it (they have no application
// history to exclude, and the RPC requires auth.uid()).

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

// The shape feed_jobs() / feed_jobs_for_candidate() both return a row of.
type FeedRow = {
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
  total_count: number | string;
};

function mapFeedRows(rows: FeedRow[]): JobCardData[] {
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
  }));
}

function feedTotal(rows: FeedRow[]): number {
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
  const rows = (data ?? []) as FeedRow[];
  return { rows: mapFeedRows(rows), total: feedTotal(rows), error: null };
}

/**
 * Candidate feed (feed_jobs_for_candidate): identity comes from auth.uid()
 * server-side, never a client-supplied id. Supports every `/jobs` sort (not
 * just Recommended) so applied-job exclusion is a discovery invariant, not a
 * Recommended-only feature. Not yet in the generated Supabase types — cast
 * the RPC name, same pattern used for other just-added RPCs in this repo
 * (e.g. `admin_set_verification`, `register_download`).
 */
export async function fetchCandidateJobFeed(
  filters: JobFeedFilters,
  sort: JobFeedSort,
  from: number,
  to: number,
): Promise<JobFeedResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase.rpc("feed_jobs_for_candidate" as any, {
    ...baseRpcArgs(filters, from, to),
    _sort: sort,
  });
  if (error) return { rows: [], total: 0, error: error.message };
  const rows = (data ?? []) as unknown as FeedRow[];
  return { rows: mapFeedRows(rows), total: feedTotal(rows), error: null };
}
