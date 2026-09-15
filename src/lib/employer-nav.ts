import {
  Activity,
  Building2,
  Briefcase,
  Inbox,
  LayoutDashboard,
  Users,
  Database,
  BarChart3,
  Coins,
  CalendarCheck,
  FileSpreadsheet,
  BadgeCheck,
} from "lucide-react";

// Shared between EmployerShell (desktop sidebar + bottom-tab "More" sheet)
// and Navbar (mobile hamburger drawer for employer sessions) so both
// surfaces list the same destinations instead of drifting apart.
export const EMPLOYER_NAV_LINKS = [
  { to: "/employer/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/employer/jobs", label: "Jobs", icon: Briefcase },
  { to: "/employer/responses", label: "Responses", icon: Inbox },
  { to: "/employer/interviews", label: "Interviews", icon: CalendarCheck },
  { to: "/employer/database", label: "Database", icon: Database },
  { to: "/employer/jobs/bulk", label: "Bulk post", icon: FileSpreadsheet },
  { to: "/employer/verification", label: "Verification", icon: BadgeCheck },
  { to: "/employer/reports", label: "Reports", icon: BarChart3 },
  { to: "/employer/activity", label: "Activity", icon: Activity },
  { to: "/employer/credits", label: "Credits", icon: Coins },
  { to: "/employer/company", label: "Company", icon: Building2 },
  { to: "/employer/team", label: "Team", icon: Users },
] as const;

// The first 4 (Dashboard/Jobs/Responses/Interviews) already sit in
// EmployerShell's mobile bottom tab bar — this is the rest.
export const EMPLOYER_OVERFLOW_LINKS = EMPLOYER_NAV_LINKS.slice(4);
