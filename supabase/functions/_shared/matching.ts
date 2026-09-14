export type AlertQuery = { keyword?: string | null; city?: string | null };

export type MatchableJob = {
  title: string;
  city: string | null;
};

/**
 * Mirrors the substring match used by the candidate-facing job search
 * (`ilike('%q%')` in src/routes/jobs.tsx) so alert matching behaves the same
 * way search does. Keyword and city are both optional on an alert, but at
 * least one is always set (enforced at alert-creation time) — when both are
 * set, a job must satisfy both.
 */
export function matchesAlert(job: MatchableJob, query: AlertQuery): boolean {
  const keyword = query.keyword?.trim().toLowerCase();
  const city = query.city?.trim().toLowerCase();

  if (keyword && !job.title.toLowerCase().includes(keyword)) return false;
  if (city && !(job.city ?? "").toLowerCase().includes(city)) return false;

  return true;
}
