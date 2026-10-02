import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  canEditCompany,
  canInviteMembers,
  canManageBilling,
  canManageTeamMembers,
  canManageVerification,
  canViewReports,
  clearCachedEmployerRole,
  fetchMyCompanies,
  getActiveCompanyId,
  getCachedEmployerRole,
  setActiveCompanyId,
  setCachedEmployerRole,
  type EmployerMembership,
  type EmployerRole,
  type EmployerRoleSnapshot,
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

/**
 * Every employer page wraps itself in its own <EmployerShell>, and every
 * EmployerShell/page calls this hook independently — there's no shared
 * layout route that mounts it once. So switching modules (dashboard → CRM)
 * unmounts and remounts this hook from scratch, and role-gated nav items
 * (Credits, Team) would briefly vanish while `role` was null during the
 * re-fetch, then reappear once it resolved — looking like a refresh glitch.
 *
 * A module-level snapshot (plus a localStorage mirror, via lib/employer.ts,
 * for the first mount after a hard reload) lets every new mount render the
 * last-known role synchronously instead of starting from
 * `loading: true, role: null`. The real fetch still runs in the background
 * on every mount to catch role changes; it just doesn't need to blank the
 * UI out first when a snapshot already exists. This is a display-only
 * optimization — every privileged action still re-checks the role in
 * Postgres regardless of what this cache holds.
 */
let memoryCache: EmployerRoleSnapshot | null = null;

function writeCache(snapshot: EmployerRoleSnapshot) {
  memoryCache = snapshot;
  setCachedEmployerRole(snapshot);
}

function initialSnapshot(): EmployerRoleSnapshot | null {
  return memoryCache ?? (memoryCache = getCachedEmployerRole());
}

/** Call on sign-out so a shared browser never flashes the previous employer's role-gated nav before the next sign-in's fetch resolves. */
export function resetEmployerRoleCache() {
  memoryCache = null;
  clearCachedEmployerRole();
}

export function useEmployerRole(): UseEmployerRole {
  const seed = initialSnapshot();
  const [loading, setLoading] = useState(seed === null);
  const [userId, setUserId] = useState<string | null>(seed?.userId ?? null);
  const [membership, setMembership] = useState<EmployerMembership | null>(seed?.membership ?? null);
  const [accessMessage, setAccessMessage] = useState<string | null>(seed?.accessMessage ?? null);

  const load = useCallback(async () => {
    // Only show the loading state when there's nothing to show yet — a
    // background refresh on an already-known role shouldn't blank out
    // role-gated nav/content while it re-verifies.
    if (memoryCache === null) setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id ?? null;
      setUserId(uid);
      if (!u.user) {
        setMembership(null);
        setAccessMessage("Sign in with an employer account to continue.");
        writeCache({
          userId: null,
          membership: null,
          accessMessage: "Sign in with an employer account to continue.",
        });
        return;
      }
      const memberships = await fetchMyCompanies(u.user.id);
      const active = getActiveCompanyId();
      const found = memberships.find((m) => m.company_id === active) ?? memberships[0] ?? null;
      if (!found) {
        setMembership(null);
        const msg = "This account is not a member of an employer company yet.";
        setAccessMessage(msg);
        writeCache({ userId: uid, membership: null, accessMessage: msg });
        return;
      }
      setActiveCompanyId(found.company_id);
      setMembership(found);
      setAccessMessage(null);
      writeCache({ userId: uid, membership: found, accessMessage: null });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Couldn't load company access.";
      setMembership(null);
      setAccessMessage(msg);
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
