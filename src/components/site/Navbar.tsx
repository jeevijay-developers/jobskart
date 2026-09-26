import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, Bookmark, FolderOpen, LogOut, Menu, Settings, User, X, Zap } from "lucide-react";
import { toast } from "sonner";
import logoAsset from "@/assets/jobskart-logo.png";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";
import { signOut } from "@/lib/auth";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EMPLOYER_OVERFLOW_LINKS } from "@/lib/employer-nav";
import { NotificationBell } from "@/components/site/NotificationBell";

// CandidateShell's bottom tab bar only surfaces Dashboard / Browse jobs /
// Applications / Interviews / Profile on mobile ΓÇö these are reachable on
// desktop via the candidate sidebar but have no mobile entry point otherwise.
const candidateMenuLinks = [
  { to: "/candidate/saved", label: "Saved jobs", icon: Bookmark },
  { to: "/candidate/alerts", label: "Job alerts", icon: Zap },
  { to: "/candidate/documents", label: "Documents", icon: FolderOpen },
  { to: "/candidate/settings", label: "Settings", icon: Settings },
] as const;

// Public site nav ΓÇö each item scrolls to its matching section on the home
// page (see the `id`s on HowItWorks/FeatureRowCandidate/FeatureRowEmployer
// in src/routes/index.tsx) rather than linking out to /jobs or /auth.
// "Jobs" has no dedicated home-page section, so it's relabelled to match
// the section it actually points to ("How it works" ΓÇö the find-a-job flow).
const homeNavLinks = [
  { hash: "how-it-works", label: "How it works" },
  { hash: "employers", label: "For Employers" },
  { hash: "candidates", label: "Candidates" },
] as const;

export function Navbar() {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [isEmployer, setIsEmployer] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isHome = pathname === "/";

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  // Same employer-membership check auth.tsx uses to route a logged-in user after login.
  useEffect(() => {
    const uid = session?.user.id;
    if (!uid) return setIsEmployer(false);
    let cancelled = false;
    supabase.from("employer_members").select("company_id").eq("user_id", uid).limit(1)
      .then(({ data: rows }) => { if (!cancelled) setIsEmployer(!!rows?.length); });
    return () => { cancelled = true; };
  }, [session]);

  const dashboardPath = isEmployer ? "/employer/dashboard" : "/candidate/dashboard";

  const handleSignOut = async () => {
    try {
      await signOut();
      toast.success("Signed out.");
      navigate({ to: "/" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign out failed.");
    }
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex h-14 w-full items-center justify-between px-4 sm:px-6 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:px-10 xl:px-16">
        <Link to="/" className="flex items-center gap-2 lg:justify-self-start">
          <img src={logoAsset} alt="JobsKart" className="h-7 w-auto" />
        </Link>

        <nav className="hidden items-center gap-7 lg:flex lg:justify-self-center xl:gap-10">
          {homeNavLinks.map((l) => (
            <Link
              key={l.hash}
              to="/"
              hash={l.hash}
              className="text-sm font-medium text-foreground/80 transition-colors hover:text-primary"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2.5 lg:flex lg:justify-self-end">
          {session ? (
            <>
              <Link
                to={dashboardPath}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground hover:bg-surface"
              >
                <User className="h-4 w-4" /> My Account
              </Link>
              <button
                onClick={handleSignOut}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground hover:bg-primary-dark"
              >
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </>
          ) : (
            <>
              <Link
                to="/auth"
                search={{ tab: "employer" }}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-primary px-4 text-sm font-semibold text-primary transition-colors hover:bg-primary-light"
              >
                Employer Login
              </Link>
              <Link
                to="/auth"
                search={{ tab: "candidate" }}
                className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary-dark"
              >
                Candidate Login
              </Link>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 lg:hidden">
          {!session && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary-dark">
                  Login
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link to="/auth" search={{ tab: "employer" }} className="cursor-pointer">
                    Employer Login
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/auth" search={{ tab: "candidate" }} className="cursor-pointer">
                    Candidate Login
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {session && !isEmployer && (
            <Link
              to="/candidate/notifications"
              aria-label="Notifications"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-foreground"
            >
              <Bell className="h-6 w-6" />
            </Link>
          )}
          {session && isEmployer && <NotificationBell />}
          <button
            aria-label="Open menu"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-foreground"
            onClick={() => setOpen(true)}
          >
            <Menu className="h-6 w-6" />
          </button>
        </div>
      </div>

      {open && createPortal(
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-foreground/40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-0 flex h-full w-80 max-w-[85vw] flex-col bg-background p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <img src={logoAsset} alt="JobsKart" className="h-7 w-auto" />
              <button
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg"
              >
                <X className="h-6 w-6" />
              </button>
            </div>
            {isHome ? (
              <nav className="mt-8 flex flex-col gap-1">
                {homeNavLinks.map((l) => (
                  <Link
                    key={l.hash}
                    to="/"
                    hash={l.hash}
                    onClick={() => setOpen(false)}
                    className="rounded-lg px-3 py-3 text-base font-medium text-foreground hover:bg-surface"
                  >
                    {l.label}
                  </Link>
                ))}
              </nav>
            ) : (
              session &&
              (isEmployer ? (
                <nav className="mt-8 flex flex-col gap-1">
                  {EMPLOYER_OVERFLOW_LINKS.map((l) => (
                    <Link
                      key={l.to}
                      to={l.to}
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-2 rounded-lg px-3 py-3 text-base font-medium text-foreground hover:bg-surface"
                    >
                      <l.icon className="h-4 w-4" /> {l.label}
                    </Link>
                  ))}
                </nav>
              ) : (
                <nav className="mt-8 flex flex-col gap-1">
                  {candidateMenuLinks.map((l) => (
                    <Link
                      key={l.to}
                      to={l.to}
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-2 rounded-lg px-3 py-3 text-base font-medium text-foreground hover:bg-surface"
                    >
                      <l.icon className="h-4 w-4" /> {l.label}
                    </Link>
                  ))}
                </nav>
              ))
            )}
            <div className="mt-auto flex flex-col gap-3 pt-6">
              {session ? (
                isHome ? (
                  <>
                    <Link
                      to={dashboardPath}
                      onClick={() => setOpen(false)}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-border text-sm font-semibold text-foreground"
                    >
                      <User className="h-4 w-4" /> My Account
                    </Link>
                    <button
                      onClick={handleSignOut}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
                    >
                      <LogOut className="h-4 w-4" /> Sign out
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleSignOut}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
                  >
                    <LogOut className="h-4 w-4" /> Sign out
                  </button>
                )
              ) : (
                !isHome && (
                  <>
                    <Link
                      to="/auth"
                      search={{ tab: "employer" }}
                      onClick={() => setOpen(false)}
                      className="inline-flex h-11 items-center justify-center rounded-lg border border-primary text-sm font-semibold text-primary"
                    >
                      Employer Login
                    </Link>
                    <Link
                      to="/auth"
                      search={{ tab: "candidate" }}
                      onClick={() => setOpen(false)}
                      className="inline-flex h-11 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
                    >
                      Candidate Login
                    </Link>
                  </>
                )
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </header>
  );
}
