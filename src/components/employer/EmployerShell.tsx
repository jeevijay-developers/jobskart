import { Link, useLocation } from "@tanstack/react-router";
import { Plus, Coins } from "lucide-react";
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
  headerLeft,
  hideBell,
  hideCreditChip,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
  /** Extra content rendered inline next to the title, on the left side of the header row. */
  headerLeft?: ReactNode;
  hideBell?: boolean;
  hideCreditChip?: boolean;
}) {
  const { pathname } = useLocation();
  const primary = nav.slice(0, 4);
  return (
    <div className="min-h-screen bg-surface pb-24 lg:pb-0">
      <Navbar />
      <div className="mx-auto flex w-full max-w-7xl gap-6 overflow-x-hidden px-4 py-6 sm:px-6 lg:px-8">
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
          <header className="mb-6 flex flex-row flex-wrap items-start justify-between gap-3 sm:items-end">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="whitespace-normal break-words text-2xl font-bold leading-tight tracking-tight text-foreground sm:truncate sm:text-3xl">{title}</h1>
                {headerLeft}
              </div>
              {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:self-auto">
              {!hideCreditChip && (
                <div className="hidden sm:block">
                  <CreditChip />
                </div>
              )}
              {!hideBell && (
                <div className="hidden sm:block">
                  <NotificationBell />
                </div>
              )}
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


