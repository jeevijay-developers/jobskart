import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  Building2,
  Briefcase,
  Database,
  Megaphone,
  GraduationCap,
  Coins,
  FileText,
  ShieldCheck,
  Settings2,
  LogOut,
  Menu,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

const nav = [
  { to: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/companies", label: "Companies", icon: Building2 },
  { to: "/admin/verifications", label: "KYC Queue", icon: ShieldCheck },
  { to: "/admin/jobs", label: "Jobs", icon: Briefcase },
  { to: "/admin/masters", label: "Master Data", icon: Database },
  { to: "/admin/plans", label: "Plan Settings", icon: Settings2 },
  { to: "/admin/banners", label: "Banners", icon: Megaphone },
  { to: "/admin/learning", label: "Learning", icon: GraduationCap },
  { to: "/admin/credits", label: "Credits", icon: Coins },
  { to: "/admin/resumes", label: "Resumes", icon: FileText },
] as const;

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation();
  return (
    <nav className="space-y-1">
      {nav.map((item) => {
        const active = pathname === item.to || pathname.startsWith(item.to + "/");
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
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
  );
}

export function AdminShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/admin/login" });
  }
  return (
    <div className="min-h-screen bg-surface">
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-4">
                <p className="mb-4 text-sm font-bold uppercase tracking-wider text-primary">Jobskart Admin</p>
                <NavList onNavigate={() => setOpen(false)} />
              </SheetContent>
            </Sheet>
            <p className="text-sm font-bold uppercase tracking-wider text-primary">Jobskart Admin</p>
          </div>
          <Button variant="ghost" size="sm" onClick={signOut} className="gap-2">
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-7xl gap-6 px-4 py-6 sm:px-6">
        <aside className="hidden w-60 shrink-0 lg:block">
          <div className="sticky top-20 rounded-2xl border border-border bg-card p-3 shadow-[var(--shadow-card)]">
            <NavList />
          </div>
        </aside>
        <main className="min-w-0 flex-1">
          <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{title}</h1>
              {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
            </div>
            {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
          </header>
          {children}
        </main>
      </div>
    </div>
  );
}
