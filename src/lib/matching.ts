// Client-side job match scoring. No AI, instant.
// Scores 0-100 based on skills overlap (60%), location match (20%),
// experience fit (15%), salary overlap (5%).

export type CandidateForMatch = {
  skills?: string[] | null;
  years_experience?: number | null;
  preferred_cities?: string[] | null;
  expected_salary?: number | null;
  city?: string | null;
};

export type JobForMatch = {
  skills?: string[] | null;
  min_experience_years?: number | null;
  max_experience_years?: number | null;
  city?: string | null;
  cities?: string[] | null;
  min_salary?: number | null;
  max_salary?: number | null;
};

function norm(s: string) {
  return s.trim().toLowerCase();
}

export function scoreJobMatch(job: JobForMatch, cand: CandidateForMatch | null): number | null {
  if (!cand) return null;
  const jSkills = (job.skills || []).map(norm).filter(Boolean);
  const cSkills = (cand.skills || []).map(norm).filter(Boolean);
  let skillScore = 60;
  if (jSkills.length) {
    const overlap = jSkills.filter((s) => cSkills.includes(s)).length;
    skillScore = Math.round((overlap / jSkills.length) * 60);
  }

  const jCities = [job.city, ...(job.cities || [])].filter(Boolean).map((s) => norm(String(s)));
  const cCities = [cand.city, ...(cand.preferred_cities || [])].filter(Boolean).map((s) => norm(String(s)));
  const locScore = !jCities.length || !cCities.length
    ? 12
    : jCities.some((c) => cCities.includes(c)) ? 20 : 4;

  const yrs = cand.years_experience ?? 0;
  const min = job.min_experience_years ?? 0;
  const max = job.max_experience_years ?? 99;
  const expScore = yrs >= min && yrs <= max ? 15 : yrs >= min - 1 && yrs <= max + 2 ? 8 : 3;

  const salScore =
    !cand.expected_salary || !job.max_salary
      ? 3
      : cand.expected_salary <= job.max_salary ? 5 : 1;

  return Math.min(100, Math.max(0, skillScore + locScore + expScore + salScore));
}

export function matchTone(score: number | null): { label: string; className: string } {
  if (score === null) return { label: "—", className: "bg-surface text-muted-foreground" };
  if (score >= 80) return { label: `${score}%`, className: "bg-success-light text-success border-success/30" };
  if (score >= 60) return { label: `${score}%`, className: "bg-warning-light text-warning border-warning/30" };
  return { label: `${score}%`, className: "bg-surface text-muted-foreground border-border" };
}
