import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
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
import { hasPermission } from "@/lib/team-permissions";

export type UseEmployerRole = {
  loading: boolean;
  userId: string | null;
  company: EmployerMembership["companies"] | null;
  companyId: string | null;
  role: EmployerRole | null;
  /** Display name of the member's role (custom roles included). */
  roleName: string | null;
  /** Effective permissions from the database, or null while loading. */
  permissions: string[] | null;
  /** UI hint only: the database re-checks every privileged action. */
  can: (permission: string) => boolean;
  accessMessage: string | null;
  isSuperAdmin: boolean;
  isHrAdmin: boolean;
  isRecruiter: boolean;
  /** Can open the Credits & billing page at all (wallet, orders, invoices). */
  canViewCredits: boolean;
  canPurchaseCredits: boolean;
  canManagePlan: boolean;
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
  const [permissions, setPermissions] = useState<string[] | null>(seed?.permissions ?? null);

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
        setPermissions(null);
        setAccessMessage("Sign in with an employer account to continue.");
        writeCache({
          userId: null,
          membership: null,
          accessMessage: "Sign in with an employer account to continue.",
          permissions: null,
        });
        return;
      }
      const memberships = await fetchMyCompanies(u.user.id);
      const active = getActiveCompanyId();
      const found = memberships.find((m) => m.company_id === active) ?? memberships[0] ?? null;
      if (!found) {
        setMembership(null);
        setPermissions(null);
        const msg = "This account is not a member of an employer company yet.";
        setAccessMessage(msg);
        writeCache({ userId: uid, membership: null, accessMessage: msg, permissions: null });
        return;
      }
      setActiveCompanyId(found.company_id);
      // Effective permissions (role + per-member add-ons). A failure here must not lock the
      // user out of the app: null makes the UI fall back to the legacy role map.
      let perms: string[] | null = null;
      try {
        const { data: p, error: pErr } = await supabase.rpc("my_permissions", { _company_id: found.company_id });
        if (!pErr && Array.isArray(p)) perms = p as string[];
      } catch {
        perms = null;
      }
      setMembership(found);
      setPermissions(perms);
      setAccessMessage(null);
      writeCache({ userId: uid, membership: found, accessMessage: null, permissions: perms });
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
  // Custom roles carry a least-privilege `recruiter` enum shadow, so only the
  // permission list is authoritative once it has loaded.
  const can = (permission: string) => hasPermission(permissions, permission, role);

  return {
    loading,
    userId,
    company: membership?.companies ?? null,
    companyId: membership?.company_id ?? null,
    role,
    roleName: membership?.company_roles?.name ?? null,
    permissions,
    can,
    accessMessage,
    isSuperAdmin: membership?.company_roles?.is_locked ?? role === "super_admin",
    isHrAdmin: role === "hr_admin",
    isRecruiter: role === "recruiter",
    canViewCredits: can("credits.purchase") || can("billing.view") || can("credits.view_all"),
    canPurchaseCredits: can("credits.purchase"),
    canManagePlan: can("billing.manage"),
    canManageBilling: can("credits.purchase") || can("billing.manage"),
    canManageTeamMembers: can("team.manage_roles") || can("team.remove") || can("roles.manage"),
    canInviteMembers: can("team.invite"),
    canEditCompany: can("company.edit"),
    canManageVerification: can("verification.manage"),
    canViewReports: can("reports.view"),
    refresh: load,
  };
}
