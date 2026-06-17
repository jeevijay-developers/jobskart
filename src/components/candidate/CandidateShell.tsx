import { Link, useLocation } from "@tanstack/react-router";
import { Bookmark, FileText, LayoutDashboard, Search, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { Navbar } from "@/components/site/Navbar";

const navItems = [
  { to: "/candidate/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/jobs", label: "Browse jobs", icon: Search },
  { to: "/candidate/applications", label: "Applications", icon: FileText },
  { to: "/candidate/saved", label: "Saved jobs", icon: Bookmark },
  { to: "/candidate/profile", label: "Profile", icon: UserRound },
] as const;

export function CandidateShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <div className="min-h-screen bg-surface">
      <Navbar />
      <div className="mx-auto flex w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <aside className="hidden w-60 shrink-0 lg:block">
          <nav className="sticky top-20 space-y-1 rounded-2xl border border-border bg-card p-3 shadow-[var(--shadow-card)]">
            {navItems.map((item) => {
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
          <header className="mb-6">
            <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{title}</h1>
            {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
          </header>
          {children}
        </main>
      </div>
    </div>
  );
}
