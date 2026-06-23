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
  highest_qualification?: string | null;
  interested_roles?: string[] | null;
  whatsapp_opt_in?: boolean | null;
};

export function computeProfileStrength(i: StrengthInput): number {
  let s = 5;
  if (i.full_name) s += 5;
  if (i.mobile) s += 5;
  if (i.city) s += 5;
  if (i.avatar_url) s += 5;
  if (i.headline) s += 5;
  if (i.last_role || (i.interested_roles?.length ?? 0) > 0) s += 5;
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
  if (i.highest_qualification) s += 5;
  if ((i.languages_count ?? 0) > 0) s += 5;
  if (i.kyc_verified) s += 5;
  if (i.whatsapp_opt_in) s += 2;
  return Math.min(s, 100);
}

export function strengthLabel(s: number): { label: string; color: string } {
  if (s >= 80) return { label: "Excellent", color: "text-success" };
  if (s >= 60) return { label: "Good", color: "text-primary" };
  if (s >= 40) return { label: "Fair", color: "text-amber-600" };
  return { label: "Just started", color: "text-muted-foreground" };
}

export type BadgeTier = "Bronze" | "Silver" | "Gold" | "Platinum";

export function computeBadge(args: {
  strength: number;
  mobileVerified?: boolean;
  emailVerified?: boolean;
  digilockerVerified?: boolean;
  hasResume?: boolean;
  experiencesCount?: number;
  educationCount?: number;
  skillsCount?: number;
}): { tier: BadgeTier; color: string } {
  let score = 0;
  if (args.strength >= 50) score++;
  if (args.strength >= 75) score++;
  if (args.strength >= 90) score++;
  if (args.mobileVerified) score++;
  if (args.emailVerified) score++;
  if (args.digilockerVerified) score += 2;
  if (args.hasResume) score++;
  if ((args.experiencesCount ?? 0) > 0) score++;
  if ((args.educationCount ?? 0) > 0) score++;
  if ((args.skillsCount ?? 0) >= 5) score++;

  if (score >= 9) return { tier: "Platinum", color: "bg-indigo-500/15 text-indigo-600" };
  if (score >= 6) return { tier: "Gold", color: "bg-amber-500/15 text-amber-700" };
  if (score >= 3) return { tier: "Silver", color: "bg-slate-400/20 text-slate-700" };
  return { tier: "Bronze", color: "bg-orange-500/15 text-orange-700" };
}
