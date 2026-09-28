import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import {
  Bell,
  Bookmark,
  FileText,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Search,
  Settings,
  UserRound,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { signOut } from "@/lib/auth";

const navItems = [
  { to: "/candidate/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/candidate/browse", label: "Browse jobs", icon: Search },
  { to: "/candidate/applications", label: "Applications", icon: FileText },
  { to: "/candidate/saved", label: "Saved jobs", icon: Bookmark },
  { to: "/candidate/alerts", label: "Job alerts", icon: Zap },
  { to: "/candidate/notifications", label: "Notifications", icon: Bell },
  { to: "/candidate/documents", label: "Documents", icon: FolderOpen },
  { to: "/candidate/profile", label: "Profile", icon: UserRound },
  { to: "/candidate/settings", label: "Settings", icon: Settings },
] as const;
const mobileItems = navItems.filter((i) =>
  [
    "/candidate/dashboard",
    "/candidate/browse",
    "/candidate/applications",
    "/candidate/profile",
  ].includes(i.to),
);

export function CandidateShell({
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
  return (
    <>
      {(title || subtitle || actions) && (
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {title}
            </h1>
            {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
          </div>
          {actions}
        </header>
      )}
      {children}
    </>
  );
}

export function CandidateAppLayout({ children }: { children?: ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    try {
      await signOut();
      toast.success("Signed out.");
      navigate({ to: "/" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sign out failed.");
    }
  };

  return (
    <div className="min-h-screen bg-surface pb-20 lg:pb-0">
      <div className="flex min-h-screen w-full min-w-0 overflow-x-hidden">
        <aside className="fixed bottom-0 left-0 top-0 z-40 hidden w-64 border-r border-border bg-card lg:block">
          <nav className="flex h-full min-h-0 flex-col">
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-4 pb-6 pt-8">
              {navItems.map((item) => {
                const active = pathname === item.to || pathname.startsWith(item.to + "/");
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={`flex h-11 items-center gap-3 whitespace-nowrap rounded-lg px-3 text-[15px] font-medium leading-none transition-colors ${
                      active
                        ? "bg-primary-light text-primary"
                        : "text-foreground/80 hover:bg-surface"
                    }`}
                  >
                    <Icon className="h-[18px] w-[18px] shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
            <div className="shrink-0 border-t border-border p-4">
              <button
                type="button"
                onClick={handleSignOut}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold text-foreground/80 transition-colors hover:border-destructive/40 hover:bg-destructive-light hover:text-destructive"
              >
                <LogOut className="h-4 w-4 shrink-0" />
                Sign out
              </button>
            </div>
          </nav>
        </aside>
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:ml-64 lg:px-8 xl:px-10 2xl:px-12">
          {children ?? <Outlet />}
        </main>
      </div>
      <CandidateMobileTabBar />
    </div>
  );
}

export function CandidateMobileTabBar() {
  const { pathname } = useLocation();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 grid grid-cols-4 border-t border-border bg-card/95 backdrop-blur lg:hidden">
      {mobileItems.map((item) => {
        const active = pathname === item.to || pathname.startsWith(item.to + "/");
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
              active ? "text-primary" : "text-muted-foreground"
            }`}
          >
            <Icon className="h-5 w-5" />
            {item.label.split(" ")[0]}
          </Link>
        );
      })}
    </nav>
  );
}
