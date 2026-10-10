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

export type EmployerNavMinRole = "super_admin" | "hr_admin";

// Shared between EmployerShell (desktop sidebar + bottom-tab "More" sheet)
// and Navbar (mobile hamburger drawer for employer sessions) so both
// surfaces list the same destinations instead of drifting apart.
// `minRole` hides the link for roles below it — see useEmployerRole().
export const EMPLOYER_NAV_LINKS: Array<{
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  minRole?: EmployerNavMinRole;
}> = [
  { to: "/employer/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/employer/jobs", label: "Jobs", icon: Briefcase },
  { to: "/employer/responses", label: "Responses", icon: Inbox },
  { to: "/employer/crm", label: "CRM", icon: PhoneCall },
  { to: "/employer/inbox", label: "Inbox", icon: MessageSquare },
  { to: "/employer/interviews", label: "Interviews", icon: CalendarCheck },
  { to: "/employer/database", label: "Database", icon: Database },
  { to: "/employer/jobs/bulk", label: "Bulk post", icon: FileSpreadsheet },
  { to: "/employer/verification", label: "Verification", icon: BadgeCheck, minRole: "hr_admin" },
  { to: "/employer/reports", label: "Reports", icon: BarChart3, minRole: "hr_admin" },
  { to: "/employer/activity", label: "Activity", icon: Activity },
  { to: "/employer/credits", label: "Credits", icon: Coins },
  { to: "/employer/company", label: "Company", icon: Building2 },
  { to: "/employer/team", label: "Team", icon: Users, minRole: "hr_admin" },
  { to: "/employer/settings", label: "Settings", icon: Settings },
];

export function isEmployerNavVisible(
  minRole: EmployerNavMinRole | undefined,
  role: "super_admin" | "hr_admin" | "recruiter" | null,
) {
  if (!minRole) return true;
  if (minRole === "super_admin") return role === "super_admin";
  return role === "super_admin" || role === "hr_admin";
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
