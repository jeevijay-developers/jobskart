import { Link, useLocation } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Navbar } from "@/components/site/Navbar";
import { NotificationBell } from "@/components/site/NotificationBell";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyCompanies, getActiveCompanyId } from "@/lib/employer";
import { EMPLOYER_NAV_LINKS as nav } from "@/lib/employer-nav";

export function CreditChip() {
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
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  if (balance === null) return null;
  const creditCapacity = 50;
  const creditProgress = Math.min(Math.max((balance / creditCapacity) * 100, 0), 100);
  return (
    <div className="w-full">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-muted-foreground">Credits Remaining</span>
        <span className="shrink-0 font-semibold text-foreground tabular-nums">
          {balance} / {creditCapacity}
        </span>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-primary-light"
        role="progressbar"
        aria-label="Credits remaining"
        aria-valuemin={0}
        aria-valuemax={creditCapacity}
        aria-valuenow={Math.min(Math.max(balance, 0), creditCapacity)}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${creditProgress}%` }}
        />
      </div>
      <Link
        to="/employer/credits"
        className="mt-3 flex h-9 w-full items-center justify-center rounded-lg border border-primary/30 bg-card px-3 text-xs font-semibold text-primary transition-colors hover:border-primary hover:bg-primary-light"
      >
        Buy Credits →
      </Link>
    </div>
  );
}

export function EmployerShell({
  title,
  subtitle,
  children,
  actions,
  headerLeft,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
  /** Extra content rendered inline next to the title, on the left side of the header row. */
  headerLeft?: ReactNode;
}) {
  const { pathname } = useLocation();
  const primary = nav.slice(0, 4);
  return (
    <div className="min-h-screen bg-surface pb-24 lg:pb-0">
      <Navbar />
      <div className="flex min-h-[calc(100vh-4rem)] w-full min-w-0 overflow-x-hidden">
        <aside className="fixed bottom-0 left-0 top-16 z-40 hidden w-64 border-r border-border bg-card lg:block">
          <nav className="flex h-full min-h-0 flex-col">
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-4 py-6">
              <Link
                to="/employer/jobs/new"
                className="mb-3 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-dark"
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
                      active
                        ? "bg-primary-light text-primary"
                        : "text-foreground/80 hover:bg-surface"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
            <div className="shrink-0 border-t border-border p-4">
              <CreditChip />
            </div>
          </nav>
        </aside>
        <main className="min-w-0 flex-1 px-3 py-6 sm:px-6 lg:ml-64 lg:px-8 xl:px-10 2xl:px-12">
          <header className="mb-6 flex flex-row flex-wrap items-start justify-between gap-3 sm:items-end">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="whitespace-normal break-words text-xl font-bold leading-tight text-foreground sm:truncate sm:text-2xl lg:text-3xl">
                  {title}
                </h1>
                {headerLeft}
              </div>
              {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:self-auto">
              <div className="hidden sm:block">
                <NotificationBell />
              </div>
              {actions}
            </div>
          </header>
          {children}
        </main>
      </div>

      <nav
        className="fixed bottom-0 left-0 right-0 z-30 grid grid-cols-4 items-stretch border-t border-border bg-card/95 backdrop-blur lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        {primary.map((item) => {
          const active = pathname === item.to || pathname.startsWith(item.to + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex min-w-0 flex-col items-center justify-center gap-1 px-0.5 py-2.5 text-center text-[10px] font-medium leading-none ${
                active ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span className="w-full truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

