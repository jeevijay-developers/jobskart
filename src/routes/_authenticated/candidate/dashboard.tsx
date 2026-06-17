import { createFileRoute, Link } from "@tanstack/react-router";
import { Briefcase, Sparkles } from "lucide-react";
import { Navbar } from "@/components/site/Navbar";

export const Route = createFileRoute("/_authenticated/candidate/dashboard")({
  head: () => ({
    meta: [{ title: "Candidate Dashboard · JobsKart" }],
  }),
  component: CandidateDashboard,
});

function CandidateDashboard() {
  return (
    <div className="min-h-screen bg-surface">
      <Navbar />
      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-border bg-card p-8 shadow-[var(--shadow-card)]">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground">
              <Sparkles className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Welcome to JobsKart!</h1>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Your candidate account is ready. The full dashboard with personalised jobs, applications
            and profile tools ships next.
          </p>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Link
              to="/"
              className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)]"
            >
              <Briefcase className="h-5 w-5 text-primary" />
              <div>
                <p className="font-semibold text-foreground">Browse jobs</p>
                <p className="text-xs text-muted-foreground">Find your next role across India</p>
              </div>
            </Link>
            <Link
              to="/"
              className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)]"
            >
              <Sparkles className="h-5 w-5 text-success" />
              <div>
                <p className="font-semibold text-foreground">Complete your profile</p>
                <p className="text-xs text-muted-foreground">3x more responses from employers</p>
              </div>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
