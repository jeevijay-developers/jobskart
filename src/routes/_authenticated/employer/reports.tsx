import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BarChart3, Eye, Users, TrendingUp } from "lucide-react";
import { EmployerShell, StatCard } from "@/components/employer/EmployerShell";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyCompanies, getActiveCompanyId, type EmployerMembership } from "@/lib/employer";

export const Route = createFileRoute("/_authenticated/employer/reports")({
  head: () => ({ meta: [{ title: "Reports · JobsKart Employer" }] }),
  component: ReportsPage,
});

function ReportsPage() {
  const [active, setActive] = useState<EmployerMembership | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ jobs: 0, apps: 0, views: 0, hired: 0 });
  const [funnel, setFunnel] = useState({ submitted: 0, reviewed: 0, shortlisted: 0, interview: 0, hired: 0, rejected: 0 });

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const ms = await fetchMyCompanies(u.user.id);
      const storedId = getActiveCompanyId();
      const chosen = ms.find((m) => m.company_id === storedId) ?? ms[0] ?? null;
      setActive(chosen);
      if (chosen) {
        const cid = chosen.company_id;
        const [{ data: jobs }] = await Promise.all([
          supabase.from("jobs").select("id, applications_count, views_count, status").eq("company_id", cid),
        ]);
        const jobIds = (jobs || []).map((j) => j.id);
        const safeIds = jobIds.length ? jobIds : ["00000000-0000-0000-0000-000000000000"];
        const [
          { count: submitted },
          { count: reviewed },
          { count: shortlisted },
          { count: interview },
          { count: hired },
          { count: rejected },
        ] = await Promise.all([
          supabase.from("applications").select("id", { count: "exact", head: true }).in("job_id", safeIds).eq("status", "submitted"),
          supabase.from("applications").select("id", { count: "exact", head: true }).in("job_id", safeIds).eq("status", "reviewed"),
          supabase.from("applications").select("id", { count: "exact", head: true }).in("job_id", safeIds).eq("status", "shortlisted"),
          supabase.from("applications").select("id", { count: "exact", head: true }).in("job_id", safeIds).eq("status", "interview"),
          supabase.from("applications").select("id", { count: "exact", head: true }).in("job_id", safeIds).eq("status", "hired"),
          supabase.from("applications").select("id", { count: "exact", head: true }).in("job_id", safeIds).eq("status", "rejected"),
        ]);
        setStats({
          jobs: (jobs || []).length,
          apps: (jobs || []).reduce((a, b) => a + (b.applications_count || 0), 0),
          views: (jobs || []).reduce((a, b) => a + (b.views_count || 0), 0),
          hired: hired || 0,
        });
        setFunnel({
          submitted: submitted || 0,
          reviewed: reviewed || 0,
          shortlisted: shortlisted || 0,
          interview: interview || 0,
          hired: hired || 0,
          rejected: rejected || 0,
        });
      }
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <EmployerShell title="Reports">
        <div className="h-40 animate-pulse rounded-2xl bg-card" />
      </EmployerShell>
    );
  }

  const max = Math.max(funnel.submitted, 1);
  const stages: Array<[string, number]> = [
    ["Submitted", funnel.submitted],
    ["Reviewed", funnel.reviewed],
    ["Shortlisted", funnel.shortlisted],
    ["Interview", funnel.interview],
    ["Hired", funnel.hired],
    ["Rejected", funnel.rejected],
  ];

  return (
    <EmployerShell title="Reports" subtitle="Hiring performance for your company.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total jobs" value={stats.jobs} tone="primary" hint="All time" />
        <StatCard label="Applications" value={stats.apps} tone="success" hint="All time" />
        <StatCard label="Profile views" value={stats.views} tone="muted" hint="All time" />
        <StatCard label="Hires" value={stats.hired} tone="success" hint="Closed" />
      </div>

      <section className="mt-6 rounded-2xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          <h2 className="text-base font-bold text-foreground">Application funnel</h2>
        </div>
        <div className="space-y-3">
          {stages.map(([label, value]) => (
            <div key={label}>
              <div className="mb-1 flex items-center justify-between text-xs font-semibold text-muted-foreground">
                <span>{label}</span>
                <span className="tabular-nums text-foreground">{value}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.round((value / max) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Eye className="mr-1 inline h-3.5 w-3.5" />
            Avg. views per job
          </p>
          <p className="mt-2 text-2xl font-bold text-foreground tabular-nums">
            {stats.jobs ? Math.round(stats.views / stats.jobs) : 0}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Users className="mr-1 inline h-3.5 w-3.5" />
            Apply rate
          </p>
          <p className="mt-2 text-2xl font-bold text-foreground tabular-nums">
            {stats.views ? Math.round((stats.apps / stats.views) * 100) : 0}%
          </p>
        </div>
      </div>
    </EmployerShell>
  );
}
