import { createFileRoute, Link } from "@tanstack/react-router";
import { Briefcase, PlusCircle, Users } from "lucide-react";
import { Navbar } from "@/components/site/Navbar";

export const Route = createFileRoute("/_authenticated/employer/dashboard")({
  head: () => ({
    meta: [{ title: "Employer Dashboard · JobsKart" }],
  }),
  component: EmployerDashboard,
});

function EmployerDashboard() {
  return (
    <div className="min-h-screen bg-surface">
      <Navbar />
      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-border bg-gradient-to-br from-primary to-primary-dark p-8 text-primary-foreground shadow-[var(--shadow-card)]">
          <h1 className="text-2xl font-bold">Welcome to JobsKart for Employers</h1>
          <p className="mt-2 text-sm text-primary-foreground/80">
            Your company is set up. Post your first job and start hiring from 50 lakh+ candidates.
          </p>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <Link to="/" className="rounded-xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)]">
            <PlusCircle className="h-6 w-6 text-primary" />
            <p className="mt-3 font-semibold text-foreground">Post a job</p>
            <p className="mt-1 text-xs text-muted-foreground">4-step smart wizard with AI score</p>
          </Link>
          <Link to="/" className="rounded-xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)]">
            <Users className="h-6 w-6 text-success" />
            <p className="mt-3 font-semibold text-foreground">Search candidates</p>
            <p className="mt-1 text-xs text-muted-foreground">Unlock verified profiles</p>
          </Link>
          <Link to="/" className="rounded-xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)]">
            <Briefcase className="h-6 w-6 text-warning" />
            <p className="mt-3 font-semibold text-foreground">Manage company</p>
            <p className="mt-1 text-xs text-muted-foreground">Verify GST/CIN, add teammates</p>
          </Link>
        </div>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          The full employer dashboard (smart posting, candidate DB, analytics) ships in the next phases.
        </p>
      </main>
    </div>
  );
}
