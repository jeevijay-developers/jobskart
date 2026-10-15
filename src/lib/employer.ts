import { supabase } from "@/integrations/supabase/client";

export type EmployerRole = "super_admin" | "hr_admin" | "recruiter";

export type EmployerMembership = {
  company_id: string;
  role: EmployerRole;
  role_id: string | null;
  company_roles: { key: string; name: string; scope: string; is_locked: boolean } | null;
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
      "company_id, role, role_id, company_roles (key, name, scope, is_locked), companies (id, name, slug, logo_url, verification_status, industry, size, hq_city)",
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
  /** Effective permission keys from my_permissions(); null until loaded (UI falls back to the legacy role map). */
  permissions?: string[] | null;
};

const ROLE_CACHE_KEY = "jobskart.employerRoleCache.v2";

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
