// Content-based "similar jobs" scoring for the job detail page's
// "Similar jobs you can apply for" section. This scores OTHER jobs
// against the CURRENT job's own attributes — distinct from matching.ts,
// which scores a job against the viewing CANDIDATE's profile for their
// own "match %" badge. No behavioral/click-tracking data exists yet, so
// this is content-only, with applications_count (the one live, trigger-
// maintained popularity signal in the schema) used purely as a tie-breaker.
//
// Weights: category/job_type match 40, city match 25, skills overlap 25,
// salary band overlap 10 — then applications_count, then recency to
// break ties among equal-scoring jobs.

export type JobForSimilarity = {
  id: string;
  category?: string | null;
  job_type?: string | null;
  city?: string | null;
  skills?: string[] | null;
  min_salary?: number | null;
  max_salary?: number | null;
};

export type RankableJob = JobForSimilarity & {
  applications_count?: number | null;
  created_at: string;
};

function norm(s: string) {
  return s.trim().toLowerCase();
}

export function scoreJobSimilarity(candidate: JobForSimilarity, current: JobForSimilarity): number {
  let score = 0;

  if (current.category && candidate.category && norm(current.category) === norm(candidate.category)) {
    score += 40;
  } else if (current.job_type && candidate.job_type && norm(current.job_type) === norm(candidate.job_type)) {
    score += 20;
  }

  if (current.city && candidate.city && norm(current.city) === norm(candidate.city)) {
    score += 25;
  }

  const curSkills = (current.skills || []).map(norm).filter(Boolean);
  const candSkills = (candidate.skills || []).map(norm).filter(Boolean);
  if (curSkills.length && candSkills.length) {
    const overlap = curSkills.filter((s) => candSkills.includes(s)).length;
    score += Math.round((overlap / curSkills.length) * 25);
  }

  const curMin = current.min_salary ?? 0;
  const curMax = current.max_salary ?? Number.POSITIVE_INFINITY;
  const candMin = candidate.min_salary ?? 0;
  const candMax = candidate.max_salary ?? Number.POSITIVE_INFINITY;
  if (curMin <= candMax && candMin <= curMax) score += 10;

  return score;
}

/**
 * Ranks a pool of candidate jobs by similarity to `current`, excluding
 * `current` itself and any id in `excludeIds` (already seen this session,
 * already applied to, etc.), and returns the top `limit`.
 */
export function rankSimilarJobs<T extends RankableJob>(
  pool: T[],
  current: JobForSimilarity,
  excludeIds: Set<string>,
  limit = 4,
): T[] {
  return pool
    .filter((j) => j.id !== current.id && !excludeIds.has(j.id))
    .map((job) => ({ job, score: scoreJobSimilarity(job, current) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const appDiff = (b.job.applications_count ?? 0) - (a.job.applications_count ?? 0);
      if (appDiff !== 0) return appDiff;
      return +new Date(b.job.created_at) - +new Date(a.job.created_at);
    })
    .slice(0, limit)
    .map((x) => x.job);
}
