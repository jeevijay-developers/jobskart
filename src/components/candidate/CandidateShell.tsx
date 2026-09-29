import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import {
  Bell,
  Bookmark,
  FileText,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  Settings,
  UserRound,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { toast } from "sonner";
import logoAsset from "@/assets/jobskart-logo.png";
import { NotificationBell } from "@/components/site/NotificationBell";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { signOut } from "@/lib/auth";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

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
// Everything not already reachable from the mobile bottom tab bar — shown in
// the hamburger drawer instead, so nothing from the desktop sidebar is lost
// on mobile without duplicating Dashboard/Browse/Applications/Profile.
const drawerItems = navItems.filter((i) => !mobileItems.includes(i));

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
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

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
              <AlertDialog open={signOutOpen} onOpenChange={setSignOutOpen}>
                <AlertDialogTrigger asChild>
                  <button
                    type="button"
                    className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold text-foreground/80 transition-colors hover:border-destructive/40 hover:bg-destructive-light hover:text-destructive"
                  >
                    <LogOut className="h-4 w-4 shrink-0" />
                    Sign out
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Sign out?</AlertDialogTitle>
                    <AlertDialogDescription>
                      You'll need to sign in again to get back to your dashboard.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleSignOut}>Sign out</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </nav>
        </aside>

        {/* Mobile-only fixed top header — same structure/behavior as
            EmployerShell's mobile header (logo left, bell + hamburger right,
            fixed while page content scrolls underneath). */}
        <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-surface px-3 lg:hidden">
          <Link to="/candidate/dashboard" className="flex items-center">
            <img src={logoAsset} alt="JobsKart" className="h-7 w-auto" />
          </Link>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <button
              type="button"
              aria-label="Open menu"
              onClick={() => setDrawerOpen(true)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-foreground"
            >
              <Menu className="h-6 w-6" />
            </button>
          </div>
        </div>

        <main className="min-w-0 flex-1 px-4 pb-6 pt-20 sm:px-6 lg:ml-64 lg:px-8 lg:py-6 xl:px-10 2xl:px-12">
          {children ?? <Outlet />}
        </main>
      </div>
      <CandidateMobileTabBar />

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        {/* Tapping any blank area inside the drawer (not an actual link/button)
            closes it, same as tapping the dark overlay. Checking
            e.target === e.currentTarget on each container means only a click
            that lands directly on that container's own background — never one
            that bubbled up from a Link or button inside it — closes the
            drawer, so menu items and Sign out are unaffected. */}
        <SheetContent
          side="right"
          className="flex w-80 max-w-[85vw] flex-col"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDrawerOpen(false);
          }}
        >
          <SheetTitle className="sr-only">Candidate navigation</SheetTitle>
          <nav
            className="flex flex-col gap-1 overflow-y-auto pr-10"
            onClick={(e) => {
              if (e.target === e.currentTarget) setDrawerOpen(false);
            }}
          >
            {drawerItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setDrawerOpen(false)}
                  className="flex items-center gap-2 rounded-lg px-3 py-3 text-base font-medium text-foreground hover:bg-surface"
                >
                  <Icon className="h-4 w-4" /> {item.label}
                </Link>
              );
            })}
          </nav>
          <div
            className="mt-auto pt-6"
            onClick={(e) => {
              if (e.target === e.currentTarget) setDrawerOpen(false);
            }}
          >
            <button
              type="button"
              onClick={() => {
                // Same confirmation as the desktop sidebar's Sign out button
                // (the AlertDialog below, shared via `signOutOpen`) — Radix
                // portals its content to document.body, so it renders fine
                // even though this button sits in the mobile-only drawer.
                setDrawerOpen(false);
                setSignOutOpen(true);
              }}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
            >
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        </SheetContent>
      </Sheet>
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
