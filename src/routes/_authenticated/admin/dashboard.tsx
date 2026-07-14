import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Briefcase, Building2, FileCheck2, IndianRupee, ShieldAlert, TrendingUp, Users } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { adminOverview } from "@/lib/admin-overview.functions";

export const Route = createFileRoute("/_authenticated/admin/dashboard")({
  head: () => ({ meta: [{ title: "Admin · Overview · JobsKart" }] }),
  component: Dash,
});

function Kpi({ icon: Icon, label, value, hint, tone = "primary", to }: { icon: typeof Users; label: string; value: string | number; hint?: string; tone?: "primary" | "success" | "amber" | "destructive"; to?: string }) {
  const toneMap: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
    amber: "bg-amber/10 text-amber",
    destructive: "bg-destructive/10 text-destructive",
  };
  const body = (
    <div className="group relative rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-hover)]">
      <div className="flex items-start justify-between">
        <div className={`grid h-10 w-10 place-items-center rounded-xl ${toneMap[tone]}`}><Icon className="h-5 w-5" /></div>
        {to && <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />}
      </div>
      <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold text-foreground sm:text-3xl">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

function Dash() {
  const fn = useServerFn(adminOverview);
  const { data } = useQuery({ queryKey: ["admin", "overview"], queryFn: () => fn() });
  const nfmt = (n?: number) => (n == null ? "—" : n.toLocaleString("en-IN"));
  return (
    <AdminShell title="Platform overview" subtitle="Live KPIs across JobsKart">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        <Kpi icon={Users} label="Total users" value={nfmt(data?.users)} hint={`${nfmt(data?.users7)} new in 7 days`} to="/admin/users" />
        <Kpi icon={Users} label="Candidates" value={nfmt(data?.candidates)} tone="success" />
        <Kpi icon={Building2} label="Employers" value={nfmt(data?.employers)} hint={`${nfmt(data?.companies)} companies`} to="/admin/companies" />
        <Kpi icon={ShieldAlert} label="KYC pending" value={nfmt(data?.kycPending)} tone={data?.kycPending ? "amber" : "primary"} to="/admin/companies" />
        <Kpi icon={Briefcase} label="Open jobs" value={nfmt(data?.jobsOpen)} hint={`${nfmt(data?.jobs)} total`} to="/admin/jobs" />
        <Kpi icon={FileCheck2} label="Applications" value={nfmt(data?.applications)} hint={`${nfmt(data?.applications7)} in last 7 days`} tone="success" />
        <Kpi icon={TrendingUp} label="Signups (7d)" value={nfmt(data?.users7)} tone="amber" />
        <Kpi icon={IndianRupee} label="Revenue (30d)" value={`₹${nfmt(data?.revenue30)}`} tone="success" to="/admin/credits" />
      </div>

      <section className="mt-8 grid gap-4 md:grid-cols-2">
        <Link to="/admin/companies" className="rounded-2xl border border-border bg-gradient-to-br from-primary/5 to-card p-6 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-hover)]">
          <h3 className="text-base font-bold text-foreground">Review KYC queue</h3>
          <p className="mt-1 text-sm text-muted-foreground">Approve or reject pending company verifications.</p>
          <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary">Open queue <ArrowUpRight className="h-4 w-4" /></span>
        </Link>
        <Link to="/admin/masters" className="rounded-2xl border border-border bg-gradient-to-br from-success/5 to-card p-6 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-hover)]">
          <h3 className="text-base font-bold text-foreground">Manage master data</h3>
          <p className="mt-1 text-sm text-muted-foreground">Cities, skills, industries and job titles.</p>
          <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary">Edit masters <ArrowUpRight className="h-4 w-4" /></span>
        </Link>
      </section>
    </AdminShell>
  );
}
