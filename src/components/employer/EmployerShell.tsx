import { Link, useLocation } from "@tanstack/react-router";
import {
  Activity,
  Building2,
  Briefcase,
  Inbox,
  LayoutDashboard,
  Plus,
  Users,
  Database,
  BarChart3,
  Coins,
  MoreHorizontal,
  X,
  CalendarCheck,
  FileSpreadsheet,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Navbar } from "@/components/site/Navbar";
import { NotificationBell } from "@/components/site/NotificationBell";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyCompanies, getActiveCompanyId } from "@/lib/employer";

const nav = [
  { to: "/employer/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/employer/jobs", label: "Jobs", icon: Briefcase },
  { to: "/employer/responses", label: "Responses", icon: Inbox },
  { to: "/employer/interviews", label: "Interviews", icon: CalendarCheck },
  { to: "/employer/database", label: "Database", icon: Database },
  { to: "/employer/jobs/bulk", label: "Bulk post", icon: FileSpreadsheet },
  { to: "/employer/reports", label: "Reports", icon: BarChart3 },
  { to: "/employer/activity", label: "Activity", icon: Activity },
  { to: "/employer/credits", label: "Credits", icon: Coins },
  { to: "/employer/company", label: "Company", icon: Building2 },
  { to: "/employer/team", label: "Team", icon: Users },
] as const;

function CreditChip() {
  const [balance, setBalance] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let cid = getActiveCompanyId();
        if (!cid) {
          const { data: u } = await supabase.auth.getUser();
          if (!u.user) return;
          const ms = await fetchMyCompanies(u.user.id);
          cid = ms[0]?.company_id ?? null;
        }
        if (!cid) return;
        const { data } = await supabase
          .from("employer_credit_wallets")
          .select("balance")
          .eq("company_id", cid)
          .maybeSingle();
        if (!cancelled) setBalance(data?.balance ?? 0);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);
  if (balance === null) return null;
  const low = balance < 5;
  return (
    <Link
      to="/employer/credits"
      className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors ${
        low
          ? "border-warning/40 bg-warning-light text-warning hover:bg-warning/15"
          : "border-border bg-card text-foreground hover:bg-surface"
      }`}
    >
      <Coins className="h-3.5 w-3.5 text-primary" />
      <span className="tabular-nums">{balance}</span>
      <span className="hidden text-[10px] font-medium text-muted-foreground sm:inline">credits</span>
      {low && <span className="hidden text-[10px] font-bold uppercase sm:inline">· buy</span>}
    </Link>
  );
}

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
  const [moreOpen, setMoreOpen] = useState(false);
  const primary = nav.slice(0, 4);
  const overflow = nav.slice(4);
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
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-2xl font-bold text-foreground sm:text-3xl">{title}</h1>
              {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <CreditChip />
              <NotificationBell />
              {actions}
            </div>
          </header>
          {children}
        </main>
      </div>

      <nav className="fixed bottom-0 left-0 right-0 z-30 grid grid-cols-6 border-t border-border bg-card/95 backdrop-blur lg:hidden">
        {primary.slice(0, 2).map((item) => {
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
          className="-mt-5 mx-1 flex flex-col items-center justify-center rounded-2xl bg-primary py-2 text-[10px] font-bold text-primary-foreground shadow-lg"
        >
          <Plus className="h-5 w-5" />
          Post
        </Link>
        {primary.slice(2, 4).map((item) => {
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
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className="flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-muted-foreground"
        >
          <MoreHorizontal className="h-5 w-5" /> More
        </button>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Close menu"
            className="flex-1 bg-foreground/40"
            onClick={() => setMoreOpen(false)}
          />
          <aside className="w-72 max-w-[85vw] overflow-y-auto bg-card p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Menu</p>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                className="rounded-lg p-2 hover:bg-surface"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <Link
              to="/employer/jobs/new"
              onClick={() => setMoreOpen(false)}
              className="mb-4 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              <Plus className="h-4 w-4" /> Post a job
            </Link>
            <div className="space-y-1">
              {overflow.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.to || pathname.startsWith(item.to + "/");
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setMoreOpen(false)}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${
                      active ? "bg-primary-light text-primary" : "text-foreground/80 hover:bg-surface"
                    }`}
                  >
                    <Icon className="h-4 w-4" /> {item.label}
                  </Link>
                );
              })}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  delta,
  tone = "primary",
}: {
  label: string;
  value: string | number;
  hint?: string;
  delta?: number;
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
      <p className="mt-2 text-3xl font-bold text-foreground tabular-nums">{value}</p>
      <div className="mt-2 flex items-center gap-2">
        {hint ? (
          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{hint}</span>
        ) : null}
        {typeof delta === "number" && delta !== 0 ? (
          <span className={`text-xs font-semibold tabular-nums ${delta > 0 ? "text-success" : "text-destructive"}`}>
            {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}
          </span>
        ) : null}
      </div>
    </div>
  );
}


