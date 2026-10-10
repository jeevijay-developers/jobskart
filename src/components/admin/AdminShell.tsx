import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  Building2,
  Briefcase,
  Database,
  Megaphone,
  Quote,
  GraduationCap,
  BookOpen,
  MessagesSquare,
  Coins,
  FileText,
  ShieldCheck,
  Settings2,
  LogOut,
  Menu,
  MessageCircle,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import logoAsset from "@/assets/jobskart-logo.png";
import { supabase } from "@/integrations/supabase/client";

const nav = [
  { to: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/companies", label: "Companies", icon: Building2 },
  { to: "/admin/verifications", label: "Company Verification", icon: ShieldCheck },
  { to: "/admin/jobs", label: "Jobs", icon: Briefcase },
  { to: "/admin/masters", label: "Master Data", icon: Database },
  { to: "/admin/plans", label: "Plan Settings", icon: Settings2 },
  { to: "/admin/banners", label: "Banners", icon: Megaphone },
  { to: "/admin/testimonials", label: "Testimonials", icon: Quote },
  { to: "/admin/site-content", label: "Site content", icon: Settings2 },
  { to: "/admin/learning", label: "Learning", icon: GraduationCap },
  { to: "/admin/content", label: "Content Library", icon: BookOpen },
  { to: "/admin/interview-prep", label: "Interview prep", icon: MessagesSquare },
  { to: "/admin/credits", label: "Credits", icon: Coins },
  { to: "/admin/resumes", label: "Resumes", icon: FileText },
  { to: "/admin/whatsapp", label: "WhatsApp", icon: MessageCircle },
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
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);
  const navigate = useNavigate();
  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/admin/login" });
  }
  return (
    <div className="min-h-screen bg-surface pt-[61px] lg:pt-0">
      <header className="fixed inset-x-0 top-0 z-30 border-b border-border bg-card/95 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-4">
                <p className="mb-4 text-sm font-bold uppercase tracking-wider text-primary">
                  Jobskart Admin
                </p>
                <NavList onNavigate={() => setOpen(false)} />
              </SheetContent>
            </Sheet>
            <p className="text-sm font-bold uppercase tracking-wider text-primary">
              Jobskart Admin
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSignOutConfirmOpen(true)}
            className="gap-2"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:mx-0 lg:max-w-none lg:gap-0 lg:p-0">
        <aside className="fixed bottom-0 left-0 top-0 z-40 hidden w-64 border-r border-border bg-card lg:block">
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center gap-2 px-4 pb-2 pt-6">
              <img src={logoAsset} alt="JobsKart" className="h-7 w-auto" />
              <span className="text-xs font-bold uppercase tracking-wider text-primary">Admin</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4">
              <NavList />
            </div>
            <div className="shrink-0 border-t border-border p-4">
              <button
                type="button"
                onClick={() => setSignOutConfirmOpen(true)}
                className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold text-foreground/80 transition-colors hover:border-destructive/40 hover:bg-destructive-light hover:text-destructive"
              >
                <LogOut className="h-3.5 w-3.5 shrink-0" /> Sign out
              </button>
            </div>
          </div>
        </aside>
        <main className="min-w-0 flex-1 lg:ml-64 lg:px-8 lg:py-6 xl:px-10 2xl:px-12">
          <header className="mb-6 flex flex-wrap items-end justify-between gap-3 lg:items-center">
            <div>
              <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{title}</h1>
              {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
            </div>
            {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
          </header>
          {children}
        </main>
      </div>

      <AlertDialog open={signOutConfirmOpen} onOpenChange={setSignOutConfirmOpen}>
        <AlertDialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-xl border-border bg-card sm:rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out?</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to sign out?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={signOut}>Sign out</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
