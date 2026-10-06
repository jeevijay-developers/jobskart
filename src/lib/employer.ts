import { supabase } from "@/integrations/supabase/client";

export type EmployerRole = "super_admin" | "hr_admin" | "recruiter";

export type EmployerMembership = {
  company_id: string;
  role: EmployerRole;
  companies: {
    id: string;
    name: string;
    slug: string | null;
    logo_url: string | null;
    verification_status: string;
    industry: string | null;
    size: string | null;
    hq_city: string | null;
  };
};

export async function fetchMyCompanies(userId: string): Promise<EmployerMembership[]> {
  const { data, error } = await supabase
    .from("employer_members")
    .select(
      "company_id, role, companies (id, name, slug, logo_url, verification_status, industry, size, hq_city)",
    )
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw error;
  return (data || []) as unknown as EmployerMembership[];
}

const KEY = "jobskart.activeCompanyId";

export function getActiveCompanyId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(KEY);
}

export function setActiveCompanyId(id: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, id);
}

export type EmployerRoleSnapshot = {
  userId: string | null;
  membership: EmployerMembership | null;
  accessMessage: string | null;
};

const ROLE_CACHE_KEY = "jobskart.employerRoleCache.v1";

/** In-memory + localStorage snapshot of the last-known employer role, read by useEmployerRole(). */
export function getCachedEmployerRole(): EmployerRoleSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ROLE_CACHE_KEY);
    return raw ? (JSON.parse(raw) as EmployerRoleSnapshot) : null;
  } catch {
    return null;
  }
}

export function setCachedEmployerRole(snapshot: EmployerRoleSnapshot) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ROLE_CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    /* best-effort; a failed write just means the next hard reload won't have a seed */
  }
}

/** Clears the cached role snapshot — call on sign-out so a shared browser never flashes the previous employer's role-gated nav before the next sign-in's fetch resolves. */
export function clearCachedEmployerRole() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ROLE_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

export function canEditCompany(role: EmployerRole | null) {
  return role === "super_admin" || role === "hr_admin";
}

export function isSuperAdmin(role: EmployerRole | null) {
  return role === "super_admin";
}

export function isHrAdmin(role: EmployerRole | null) {
  return role === "hr_admin";
}

export function isRecruiter(role: EmployerRole | null) {
  return role === "recruiter";
}

export function canManageBilling(role: EmployerRole | null) {
  // Credits/plan management is open to every company role — recruiter and
  // hr_admin can buy credit packs and switch plans, same as super_admin.
  return role !== null;
}

export function canManageTeamMembers(role: EmployerRole | null) {
  return role === "super_admin";
}

export function canInviteMembers(role: EmployerRole | null) {
  return role === "super_admin" || role === "hr_admin";
}

export function canManageVerification(role: EmployerRole | null) {
  return role === "super_admin" || role === "hr_admin";
}

export function canViewReports(role: EmployerRole | null) {
  return role === "super_admin" || role === "hr_admin";
}
