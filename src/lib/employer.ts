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
    .eq("user_id", userId);
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

export function canEditCompany(role: EmployerRole) {
  return role === "super_admin" || role === "hr_admin";
}
