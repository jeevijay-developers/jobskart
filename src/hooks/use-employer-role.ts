import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  canEditCompany,
  canInviteMembers,
  canManageBilling,
  canManageTeamMembers,
  canManageVerification,
  canViewReports,
  fetchMyCompanies,
  getActiveCompanyId,
  setActiveCompanyId,
  type EmployerMembership,
  type EmployerRole,
} from "@/lib/employer";

export type UseEmployerRole = {
  loading: boolean;
  userId: string | null;
  company: EmployerMembership["companies"] | null;
  companyId: string | null;
  role: EmployerRole | null;
  accessMessage: string | null;
  isSuperAdmin: boolean;
  isHrAdmin: boolean;
  isRecruiter: boolean;
  canManageBilling: boolean;
  canManageTeamMembers: boolean;
  canInviteMembers: boolean;
  canEditCompany: boolean;
  canManageVerification: boolean;
  canViewReports: boolean;
  refresh: () => Promise<void>;
};

export function useEmployerRole(): UseEmployerRole {
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [membership, setMembership] = useState<EmployerMembership | null>(null);
  const [accessMessage, setAccessMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      setUserId(u.user?.id ?? null);
      if (!u.user) {
        setMembership(null);
        setAccessMessage("Sign in with an employer account to continue.");
        return;
      }
      const memberships = await fetchMyCompanies(u.user.id);
      const active = getActiveCompanyId();
      const found = memberships.find((m) => m.company_id === active) ?? memberships[0] ?? null;
      if (!found) {
        setMembership(null);
        setAccessMessage("This account is not a member of an employer company yet.");
        return;
      }
      setActiveCompanyId(found.company_id);
      setMembership(found);
      setAccessMessage(null);
    } catch (error) {
      setMembership(null);
      setAccessMessage(error instanceof Error ? error.message : "Couldn't load company access.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const role = membership?.role ?? null;

  return {
    loading,
    userId,
    company: membership?.companies ?? null,
    companyId: membership?.company_id ?? null,
    role,
    accessMessage,
    isSuperAdmin: role === "super_admin",
    isHrAdmin: role === "hr_admin",
    isRecruiter: role === "recruiter",
    canManageBilling: canManageBilling(role),
    canManageTeamMembers: canManageTeamMembers(role),
    canInviteMembers: canInviteMembers(role),
    canEditCompany: canEditCompany(role),
    canManageVerification: canManageVerification(role),
    canViewReports: canViewReports(role),
    refresh: load,
  };
}
