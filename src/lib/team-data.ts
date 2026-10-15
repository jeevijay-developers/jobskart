import { supabase } from "@/integrations/supabase/client";
import type { BenefitType, PermissionDef } from "@/lib/team-permissions";

export type RoleRow = {
  id: string;
  company_id: string | null;
  key: string;
  name: string;
  description: string;
  is_system: boolean;
  is_locked: boolean;
  scope: "own" | "team" | "all";
  permissions: string[];
};

export type TeamMember = {
  user_id: string;
  role_id: string | null;
  reports_to: string | null;
  status: string;
  revoked_at: string | null;
  extra_permissions: string[];
  revoked_permissions: string[];
  role: "super_admin" | "hr_admin" | "recruiter";
  company_roles: { key: string; name: string; scope: string; is_locked: boolean } | null;
  profiles: { full_name: string | null; email: string | null } | null;
  /** The email the invite was actually sent to (accept_invite() lets any signed-in account accept a
   * token, so this can differ from profiles.email — e.g. a mobile-OTP account whose profile email is
   * an auto-generated `m<mobile>@jobskart.app` placeholder, not anything the admin typed). Null for
   * members added outside the invite flow (e.g. the company creator). */
  invited_email: string | null;
};

export type TeamInvite = {
  id: string;
  email: string;
  role_id: string | null;
  token: string;
  expires_at: string;
  created_at: string;
  company_roles: { name: string } | null;
};

export type CreditSummary = {
  mode: "pooled" | "allocated";
  can_pool_spend: boolean;
  /** True for credit/billing viewers; everyone else only sees their own balance (and the shared one in pooled mode). */
  can_view_all: boolean;
  benefits: Record<
    BenefitType,
    { wallet: number | null; reserved: number | null; pool: number | null; mine: number }
  >;
};

export type AllocationRow = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role_name: string;
  reports_to: string | null;
  benefit_type: BenefitType;
  balance: number;
  spent_30d: number;
};

export type CreditRequest = {
  id: string;
  requester: string;
  benefit_type: BenefitType;
  qty: number;
  reason: string;
  routed_to: string | null;
  status: "pending" | "approved" | "denied" | "cancelled";
  decision_note: string | null;
  created_at: string;
  profiles: { full_name: string | null } | null;
};

const MEMBER_SELECT =
  "user_id, role, role_id, reports_to, status, revoked_at, extra_permissions, revoked_permissions, company_roles(key, name, scope, is_locked), profiles:profiles!employer_members_user_id_profiles_fkey(full_name, email)";

export async function fetchTeam(companyId: string) {
  const [active, revoked, invites, accepted] = await Promise.all([
    supabase
      .from("employer_members")
      .select(MEMBER_SELECT)
      .eq("company_id", companyId)
      .eq("status", "active"),
    supabase
      .from("employer_members")
      .select(MEMBER_SELECT)
      .eq("company_id", companyId)
      .eq("status", "revoked"),
    supabase
      .from("employer_invites")
      .select("id, email, role_id, token, expires_at, created_at, company_roles(name)")
      .eq("company_id", companyId)
      .is("accepted_at", null)
      .order("created_at", { ascending: false }),
    // accept_invite() lets any signed-in account accept a token, so the member row's profile email
    // can be an unrelated placeholder — look up what the invite was actually sent to, per accepter,
    // so the UI can show that instead (see TeamMember.invited_email).
    supabase
      .from("employer_invites")
      .select("email, accepted_by")
      .eq("company_id", companyId)
      .not("accepted_by", "is", null)
      .order("accepted_at", { ascending: false }),
  ]);
  const err = active.error ?? revoked.error ?? invites.error ?? accepted.error;
  if (err) throw new Error(err.message);

  // Most recent accepted invite per user wins (e.g. revoke -> re-invite -> accept again).
  const invitedEmailByUser = new Map<string, string>();
  for (const row of accepted.data ?? []) {
    if (row.accepted_by && !invitedEmailByUser.has(row.accepted_by)) {
      invitedEmailByUser.set(row.accepted_by, row.email);
    }
  }
  const withInvitedEmail = (rows: unknown[]) =>
    (rows as TeamMember[]).map((m) => ({
      ...m,
      invited_email: invitedEmailByUser.get(m.user_id) ?? null,
    }));

  return {
    members: withInvitedEmail(active.data ?? []),
    revoked: withInvitedEmail(revoked.data ?? []),
    invites: (invites.data ?? []) as unknown as TeamInvite[],
  };
}

export async function fetchRoles(companyId: string): Promise<RoleRow[]> {
  const { data, error } = await supabase
    .from("company_roles")
    .select(
      "id, company_id, key, name, description, is_system, is_locked, scope, company_role_permissions(permission_key)",
    )
    .or(`company_id.is.null,company_id.eq.${companyId}`)
    .order("is_system", { ascending: false })
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    company_id: r.company_id,
    key: r.key,
    name: r.name,
    description: r.description,
    is_system: r.is_system,
    is_locked: r.is_locked,
    scope: r.scope as RoleRow["scope"],
    permissions: (
      (r as unknown as { company_role_permissions: { permission_key: string }[] })
        .company_role_permissions ?? []
    ).map((p) => p.permission_key),
  }));
}

export async function fetchPermissionCatalog(): Promise<PermissionDef[]> {
  const { data, error } = await supabase
    .from("permission_catalog")
    .select("key, grp, label, description, is_sensitive, sort_order")
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []) as PermissionDef[];
}

export async function fetchCustomRolesEnabled(companyId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("company_has_custom_roles", {
    _company_id: companyId,
  });
  if (error) return false;
  return !!data;
}

export async function fetchCreditSummary(companyId: string): Promise<CreditSummary> {
  const { data, error } = await supabase.rpc("credit_summary", { _company_id: companyId });
  if (error) throw new Error(error.message);
  return data as unknown as CreditSummary;
}

export async function fetchAllocationOverview(companyId: string): Promise<AllocationRow[]> {
  const { data, error } = await supabase.rpc("credit_allocation_overview", {
    _company_id: companyId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as AllocationRow[];
}

export async function fetchCreditRequests(companyId: string): Promise<CreditRequest[]> {
  const { data, error } = await supabase
    .from("credit_requests")
    .select(
      "id, requester, benefit_type, qty, reason, routed_to, status, decision_note, created_at",
    )
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Omit<CreditRequest, "profiles">[];
  const ids = [...new Set(rows.map((r) => r.requester))];
  const names = new Map<string, string | null>();
  if (ids.length) {
    const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
    for (const p of profs ?? []) names.set(p.id, p.full_name);
  }
  return rows.map((r) => ({ ...r, profiles: { full_name: names.get(r.requester) ?? null } }));
}

export type CompanySettings = {
  access_mode: "open" | "scoped";
  credit_mode: "pooled" | "allocated";
  low_credit_threshold: number;
  name: string;
};

export type SeatStatus = { used: number; pending: number; max: number };

export type TopupRule = {
  id: string;
  user_id: string;
  benefit_type: BenefitType;
  target_balance: number;
  cadence: "weekly" | "monthly";
  next_run_at: string;
  active: boolean;
};

export type CreditMovement = {
  created_at: string;
  event: string;
  benefit_type: BenefitType;
  qty: number;
  from_name: string;
  to_name: string;
  actor_name: string;
};

export async function fetchCompanySettings(companyId: string): Promise<CompanySettings> {
  const { data, error } = await supabase.rpc("company_team_settings", { _company_id: companyId });
  if (error) throw new Error(error.message);
  return data as unknown as CompanySettings;
}

export async function fetchSeatStatus(companyId: string): Promise<SeatStatus> {
  const { data, error } = await supabase.rpc("team_seat_status", { _company_id: companyId });
  if (error) throw new Error(error.message);
  return data as unknown as SeatStatus;
}

export async function fetchTopupRules(companyId: string): Promise<TopupRule[]> {
  const { data, error } = await supabase
    .from("credit_topup_rules")
    .select("id, user_id, benefit_type, target_balance, cadence, next_run_at, active")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as TopupRule[];
}

export async function fetchMovements(companyId: string, days = 90): Promise<CreditMovement[]> {
  const { data, error } = await supabase.rpc("member_credit_movements", {
    _company_id: companyId,
    _days: days,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as CreditMovement[];
}
