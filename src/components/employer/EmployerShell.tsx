import { Link, useLocation } from "@tanstack/react-router";
import {
  Building2,
  Briefcase,
  LayoutDashboard,
  Plus,
  Users,
  Settings,
  Database,
  BarChart3,
  Coins,
} from "lucide-react";
import type { ReactNode } from "react";
import { Navbar } from "@/components/site/Navbar";
import { NotificationBell } from "@/components/site/NotificationBell";

const nav = [
  { to: "/employer/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/employer/jobs", label: "Jobs", icon: Briefcase },
  { to: "/employer/database", label: "Database", icon: Database },
  { to: "/employer/credits", label: "Credits", icon: Coins },
  { to: "/employer/reports", label: "Reports", icon: BarChart3 },
  { to: "/employer/company", label: "Company", icon: Building2 },
  { to: "/employer/team", label: "Team", icon: Users },
] as const;

export function EmployerShell({
  title,
  subtitle,
  children,
  actions,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const { pathname } = useLocation();
  return (
    <div className="min-h-screen bg-surface pb-20 lg:pb-0">
      <Navbar />
      <div className="mx-auto flex w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <aside className="hidden w-60 shrink-0 lg:block">
          <nav className="sticky top-20 space-y-1 rounded-2xl border border-border bg-card p-3 shadow-[var(--shadow-card)]">
            <Link
              to="/employer/jobs/new"
              className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-dark"
            >
              <Plus className="h-4 w-4" /> Post a job
            </Link>
            {nav.map((item) => {
              const active = pathname === item.to || pathname.startsWith(item.to + "/");
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    active ? "bg-primary-light text-primary" : "text-foreground/80 hover:bg-surface"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>
        <main className="min-w-0 flex-1">
          <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{title}</h1>
              {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
            </div>
            <div className="flex items-center gap-3">
              <NotificationBell />
              {actions}
            </div>
          </header>
          {children}
        </main>
      </div>

      <nav className="fixed bottom-0 left-0 right-0 z-30 grid grid-cols-5 border-t border-border bg-card/95 backdrop-blur lg:hidden">
        {nav.slice(0, 4).map((item) => {
          const active = pathname === item.to || pathname.startsWith(item.to + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium ${
                active ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <Icon className="h-5 w-5" /> {item.label}
            </Link>
          );
        })}
        <Link
          to="/employer/jobs/new"
          className="flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-primary"
        >
          <Plus className="h-5 w-5" /> Post
        </Link>
      </nav>
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "primary",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "primary" | "success" | "warning" | "muted";
}) {
  const tones: Record<string, string> = {
    primary: "bg-primary-light text-primary",
    success: "bg-success-light text-success",
    warning: "bg-warning-light text-warning",
    muted: "bg-surface text-muted-foreground",
  };
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-bold text-foreground">{value}</p>
      {hint ? (
        <p className={`mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{hint}</p>
      ) : null}
    </div>
  );
}

export function Settings_ ({ }: { unused?: boolean }) { return <Settings className="hidden" />; }
