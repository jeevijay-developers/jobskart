// Pure team/permission helpers (no I/O): safe to unit-test and to import anywhere.
// The database is the authority (has_company_permission); everything here is a UI hint.

export type LegacyRole = "super_admin" | "hr_admin" | "recruiter";
export type BenefitType = "job_post" | "contact" | "boost";

export const BENEFIT_TYPES: BenefitType[] = ["job_post", "contact", "boost"];
export const BENEFIT_LABELS: Record<BenefitType, string> = {
  job_post: "Job posts",
  contact: "Contact unlocks",
  boost: "Boosts",
};

export type PermissionDef = {
  key: string;
  grp: string;
  label: string;
  description: string;
  is_sensitive: boolean;
  sort_order: number;
};

export function groupPermissions(
  defs: PermissionDef[],
): Array<{ group: string; items: PermissionDef[] }> {
  const sorted = [...defs].sort((a, b) => a.sort_order - b.sort_order);
  const groups: Array<{ group: string; items: PermissionDef[] }> = [];
  for (const d of sorted) {
    let g = groups.find((x) => x.group === d.grp);
    if (!g) {
      g = { group: d.grp, items: [] };
      groups.push(g);
    }
    g.items.push(d);
  }
  return groups;
}

// Mirrors the system-template seeds in 20261015100000_team_permissions_foundation.sql.
// Used only while the real permission list is loading (or if the RPC is unavailable),
// so the UI behaves like the old role checks instead of flashing empty.
const COMMON_SPEND = ["credits.purchase", "billing.view", "billing.manage"];
export const LEGACY_ROLE_PERMISSIONS: Record<LegacyRole, string[]> = {
  super_admin: ["*"],
  hr_admin: [
    "jobs.view",
    "jobs.create",
    "jobs.edit",
    "jobs.close",
    "jobs.boost",
    "applicants.view",
    "applicants.manage",
    "applicants.export",
    "candidates.search",
    "candidates.unlock",
    "team.view",
    "team.invite",
    "company.edit",
    "verification.manage",
    "reports.view",
    "activity.view",
    "credits.view_own",
    "credits.view_team",
    "credits.view_all",
    ...COMMON_SPEND,
  ],
  recruiter: [
    "jobs.view",
    "jobs.create",
    "jobs.edit",
    "jobs.close",
    "jobs.boost",
    "applicants.view",
    "applicants.manage",
    "candidates.search",
    "candidates.unlock",
    "team.view",
    "credits.view_own",
    ...COMMON_SPEND,
  ],
};

export function hasPermission(
  permissions: readonly string[] | null | undefined,
  key: string,
  fallbackRole: LegacyRole | null,
): boolean {
  if (permissions) return permissions.includes(key);
  if (!fallbackRole) return false;
  const list = LEGACY_ROLE_PERMISSIONS[fallbackRole];
  return list.includes("*") || list.includes(key);
}

/** Permissions in `wanted` that the caller does not hold (owners hold everything). */
export function missingForGrant(
  mine: readonly string[],
  wanted: readonly string[],
  isOwner: boolean,
): string[] {
  if (isOwner) return [];
  return wanted.filter((p) => !mine.includes(p));
}

export function permissionDiff(before: readonly string[], after: readonly string[]) {
  return {
    added: after.filter((p) => !before.includes(p)),
    removed: before.filter((p) => !after.includes(p)),
  };
}

/** Everyone who (transitively) reports to `root`, never including `root` itself. */
export function subtreeIds(
  members: ReadonlyArray<{ user_id: string; reports_to: string | null }>,
  root: string,
): Set<string> {
  const byManager = new Map<string, string[]>();
  for (const m of members) {
    if (!m.reports_to) continue;
    const list = byManager.get(m.reports_to) ?? [];
    list.push(m.user_id);
    byManager.set(m.reports_to, list);
  }
  const out = new Set<string>();
  const stack = [...(byManager.get(root) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id) || id === root) continue;
    out.add(id);
    stack.push(...(byManager.get(id) ?? []));
  }
  return out;
}

const TEAM_ERRORS: Record<string, string> = {
  insufficient_permissions: "You don't have permission to do that.",
  cannot_escalate: "You can only grant permissions that you hold yourself.",
  last_super_admin: "A company must always keep at least one Owner.",
  role_in_use:
    "This role is still assigned to teammates or pending invites. Move them to another role first.",
  role_locked: "This role can't be edited.",
  role_name_taken: "A role with this name already exists.",
  invalid_role_name: "Role names must be 2 to 60 characters.",
  invalid_scope: "Pick a valid job visibility.",
  role_limit_reached: "You've reached the limit of 25 custom roles.",
  role_not_found: "That role no longer exists.",
  role_wrong_company: "That role belongs to a different company.",
  plan_requires_upgrade:
    "Custom roles and per-member permissions are available on paid plans. Upgrade to unlock them.",
  unknown_permission: "That permission doesn't exist.",
  invite_already_pending: "There is already a pending invite for this email.",
  invalid_email: "Enter a valid email address.",
  hierarchy_cycle: "That reporting line would create a loop.",
  manager_not_member: "The chosen manager is not an active member of this company.",
  pool_insufficient: "The company pool doesn't have that many credits available.",
  holder_insufficient: "You don't have that many credits to give. Ask an admin for more.",
  member_balance_insufficient:
    "You've used all the credits allocated to you. Request more from your manager or an admin in Team > Credits.",
  target_not_in_subtree: "You can only manage credits for people who report to you.",
  target_cannot_spend: "That teammate's role can't use this type of credit.",
  target_not_member: "That person isn't an active member of this company.",
  reclaim_exceeds_balance: "They don't hold that many credits.",
  allocation_mode_off: "Per-member credit allocation is switched off for this company.",
  request_not_pending: "This request was already handled.",
  request_not_found: "This request no longer exists.",
  too_many_pending_requests: "You already have 5 pending credit requests.",
  invalid_quantity: "Enter a whole number greater than zero.",
  invalid_mode: "Unknown credit mode.",
  no_credits: "Not enough credits. Buy a pack to continue.",
  seat_limit_reached:
    "Your plan's team seat limit is full. Remove someone or upgrade the plan to add more people.",
  target_cannot_own_jobs: "That teammate's role can't post jobs, so they can't take these over.",
  invalid_access: "Pick a valid access level.",
  invalid_cadence: "Pick weekly or monthly.",
  rule_not_found: "That top-up rule no longer exists.",
  job_not_found: "That job no longer exists.",
  invalid_transfer: "Pick a different person.",
};

/** Turns a raw Postgres/PostgREST error message into friendly copy; unknown messages pass through. */
export function mapTeamError(message: string | null | undefined): string {
  const text = message ?? "";
  for (const [code, friendly] of Object.entries(TEAM_ERRORS)) {
    if (text.includes(code)) return friendly;
  }
  return text || "Something went wrong. Please try again.";
}

export function isMemberCreditShortfall(message: string | null | undefined): boolean {
  return (message ?? "").includes("member_balance_insufficient");
}

export type SummaryBenefit = {
  wallet: number | null;
  reserved: number | null;
  pool: number | null;
  mine: number;
};
export type SummaryLike = {
  mode: "pooled" | "allocated";
  can_pool_spend: boolean;
  benefits: Record<BenefitType, SummaryBenefit>;
};

/** What the caller can actually spend right now, given what credit_summary() chose to reveal. */
export function spendableBalance(summary: SummaryLike, benefit: BenefitType): number {
  const b = summary.benefits[benefit];
  if (summary.mode === "allocated") {
    return summary.can_pool_spend ? b.mine + Math.max(0, b.pool ?? 0) : b.mine;
  }
  return b.wallet ?? 0;
}

/** Toast copy for a failed credit spend (unlock / invite): shortfall codes get actionable text, the rest passes through. */
export function creditSpendMessage(message: string, verb: "invite" | "unlock"): string {
  if (message.includes("member_balance_insufficient") || message.includes("pool_insufficient")) {
    return mapTeamError(message);
  }
  if (message.includes("insufficient_permissions")) return mapTeamError(message);
  if (message.includes("no_credits")) return `Out of credits. Buy a pack to ${verb}.`;
  return message;
}

/** RFC 4180 CSV with a formula-injection guard (cells starting with = + - @ tab or CR are prefixed with a quote). */
export function toCsv(
  headers: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>,
): string {
  const cell = (v: string | number | null | undefined) => {
    let t = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [headers.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\r\n");
}

/** wa.me share link with a prefilled invite message (no phone number needed: the sender picks the chat). */
export function whatsappShareUrl(companyName: string, inviteLink: string): string {
  const text = `You've been invited to join ${companyName} on JobsKart. Accept here: ${inviteLink}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function parseQuantity(input: string): number | null {
  if (!/^\d{1,6}$/.test(input.trim())) return null;
  const n = Number(input.trim());
  return n >= 1 && n <= 100000 ? n : null;
}
