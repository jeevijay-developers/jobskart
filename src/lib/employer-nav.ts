import {
  Activity,
  Building2,
  Briefcase,
  Inbox,
  LayoutDashboard,
  MessageSquare,
  PhoneCall,
  Users,
  Database,
  BarChart3,
  Coins,
  CalendarCheck,
  FileSpreadsheet,
  BadgeCheck,
  Settings,
} from "lucide-react";

// Shared between EmployerShell (desktop sidebar + bottom-tab "More" sheet)
// and Navbar (mobile hamburger drawer for employer sessions) so both
// surfaces list the same destinations instead of drifting apart.
// `permission` hides the link unless the member holds that permission — see useEmployerRole().can().
export const EMPLOYER_NAV_LINKS: Array<{
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Visible when the member holds this permission (or any of them, if a list). */
  permission?: string | string[];
}> = [
  { to: "/employer/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/employer/jobs", label: "Jobs", icon: Briefcase },
  { to: "/employer/responses", label: "Responses", icon: Inbox },
  { to: "/employer/crm", label: "CRM", icon: PhoneCall },
  { to: "/employer/inbox", label: "Inbox", icon: MessageSquare },
  { to: "/employer/interviews", label: "Interviews", icon: CalendarCheck },
  { to: "/employer/database", label: "Database", icon: Database },
  { to: "/employer/jobs/bulk", label: "Bulk post", icon: FileSpreadsheet },
  { to: "/employer/verification", label: "Verification", icon: BadgeCheck, permission: "verification.manage" },
  { to: "/employer/reports", label: "Reports", icon: BarChart3, permission: "reports.view" },
  { to: "/employer/activity", label: "Activity", icon: Activity },
  {
    to: "/employer/credits",
    label: "Credits",
    icon: Coins,
    permission: ["credits.purchase", "billing.view", "credits.view_all"],
  },
  { to: "/employer/company", label: "Company", icon: Building2 },
  { to: "/employer/team", label: "Team", icon: Users, permission: "team.view" },
  { to: "/employer/settings", label: "Settings", icon: Settings },
];

// A nav item is active on an exact match, or on a path-segment prefix match
// (so "Jobs" stays active on its own sub-pages like job detail/edit) —
// EXCEPT when a sibling nav item is a longer/more specific prefix match for
// the current pathname, e.g. "/employer/jobs/bulk" (Bulk post) living under
// "/employer/jobs" (Jobs): both match by prefix, so only the longest match
// (Bulk post) should light up. Generalizes to any future sibling that nests
// under another nav item's path the same way.
export function isEmployerNavItemActive(pathname: string, to: string): boolean {
  if (pathname === to) return true;
  if (!pathname.startsWith(to + "/")) return false;
  const moreSpecificSiblingMatches = EMPLOYER_NAV_LINKS.some(
    (other) =>
      other.to !== to &&
      other.to.startsWith(to + "/") &&
      (pathname === other.to || pathname.startsWith(other.to + "/")),
  );
  return !moreSpecificSiblingMatches;
}

export function isEmployerNavVisible(
  permission: string | string[] | undefined,
  can: (permission: string) => boolean,
) {
  if (!permission) return true;
  return Array.isArray(permission) ? permission.some(can) : can(permission);
}

// Dashboard/Jobs/Responses/Interviews sit in EmployerShell's mobile bottom tab
// bar — named by `to` (not sliced by index) so inserting a new item like Inbox
// above Interviews can't silently swap one of these four out of the bar.
const MOBILE_PRIMARY_ROUTES = [
  "/employer/dashboard",
  "/employer/jobs",
  "/employer/responses",
  "/employer/interviews",
];
export const EMPLOYER_PRIMARY_LINKS = MOBILE_PRIMARY_ROUTES.map(
  (to) => EMPLOYER_NAV_LINKS.find((item) => item.to === to)!,
);
export const EMPLOYER_OVERFLOW_LINKS = EMPLOYER_NAV_LINKS.filter(
  (item) => !MOBILE_PRIMARY_ROUTES.includes(item.to),
);
