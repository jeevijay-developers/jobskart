export type StrengthInput = {
  full_name?: string | null;
  mobile?: string | null;
  city?: string | null;
  avatar_url?: string | null;
  headline?: string | null;
  last_role?: string | null;
  bio?: string | null;
  skills?: string[] | null;
  years_experience?: number | null;
  preferred_job_types?: string[] | null;
  preferred_cities?: string[] | null;
  expected_salary?: number | null;
  resume_url?: string | null;
  experiences_count?: number;
  education_count?: number;
  languages_count?: number;
  kyc_verified?: boolean;
};

export function computeProfileStrength(i: StrengthInput): number {
  let s = 10;
  if (i.full_name) s += 5;
  if (i.mobile) s += 5;
  if (i.city) s += 5;
  if (i.avatar_url) s += 5;
  if (i.headline) s += 5;
  if (i.last_role) s += 5;
  if (i.bio && i.bio.length > 30) s += 5;
  if ((i.skills?.length ?? 0) >= 3) s += 10;
  else if ((i.skills?.length ?? 0) > 0) s += 5;
  if ((i.years_experience ?? 0) > 0) s += 5;
  if ((i.preferred_job_types?.length ?? 0) > 0) s += 5;
  if ((i.preferred_cities?.length ?? 0) > 0) s += 5;
  if (i.expected_salary) s += 5;
  if (i.resume_url) s += 10;
  if ((i.experiences_count ?? 0) > 0) s += 5;
  if ((i.education_count ?? 0) > 0) s += 5;
  if ((i.languages_count ?? 0) > 0) s += 5;
  if (i.kyc_verified) s += 5;
  return Math.min(s, 100);
}

export function strengthLabel(s: number): { label: string; color: string } {
  if (s >= 80) return { label: "Excellent", color: "text-success" };
  if (s >= 60) return { label: "Good", color: "text-primary" };
  if (s >= 40) return { label: "Fair", color: "text-amber-600" };
  return { label: "Just started", color: "text-muted-foreground" };
}
