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

export type IncompleteField = { key: string; sectionId: string; label: string };

/**
 * Same checks as computeProfileStrength, but reports which specific ones are
 * failing, each tagged with the id of the profile-page section that fixes it
 * (see src/routes/_authenticated/candidate/profile.tsx). highest_qualification
 * and whatsapp_opt_in are only editable during onboarding, not on the profile
 * page, so they're intentionally left out — there's no section to point to.
 */
export function getIncompleteProfileFields(i: StrengthInput): IncompleteField[] {
  const out: IncompleteField[] = [];
  if (!i.full_name) out.push({ key: "full_name", sectionId: "personal", label: "Add your full name" });
  if (!i.mobile) out.push({ key: "mobile", sectionId: "personal", label: "Add your mobile number" });
  if (!i.city) out.push({ key: "city", sectionId: "personal", label: "Add your city" });
  if (!i.avatar_url) out.push({ key: "avatar_url", sectionId: "personal", label: "Add a profile photo" });
  if (!i.headline) out.push({ key: "headline", sectionId: "personal", label: "Add a professional headline" });
  if (!(i.bio && i.bio.length > 30)) out.push({ key: "bio", sectionId: "personal", label: "Write a short bio (30+ characters)" });
  if (!i.last_role && (i.interested_roles?.length ?? 0) === 0) out.push({ key: "last_role", sectionId: "career", label: "Add your current or last role" });
  if ((i.years_experience ?? 0) <= 0) out.push({ key: "years_experience", sectionId: "career", label: "Add your years of experience" });
  if ((i.preferred_job_types?.length ?? 0) === 0) out.push({ key: "preferred_job_types", sectionId: "career", label: "Add your preferred job types" });
  if ((i.preferred_cities?.length ?? 0) === 0) out.push({ key: "preferred_cities", sectionId: "career", label: "Add preferred cities" });
  if (!i.expected_salary) out.push({ key: "expected_salary", sectionId: "career", label: "Add your expected salary" });
  if ((i.skills?.length ?? 0) < 3) out.push({ key: "skills", sectionId: "skills", label: "Add at least 3 skills" });
  if (!i.resume_url) out.push({ key: "resume_url", sectionId: "resume", label: "Upload your resume" });
  if ((i.experiences_count ?? 0) === 0) out.push({ key: "experiences_count", sectionId: "experience", label: "Add your work experience" });
  if ((i.education_count ?? 0) === 0) out.push({ key: "education_count", sectionId: "education", label: "Add your education" });
  if ((i.languages_count ?? 0) === 0) out.push({ key: "languages_count", sectionId: "languages", label: "Add a language you speak" });
  if (!i.kyc_verified) out.push({ key: "kyc_verified", sectionId: "kyc", label: "Verify your identity" });
  return out;
}
