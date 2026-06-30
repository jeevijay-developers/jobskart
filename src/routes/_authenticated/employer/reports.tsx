import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { BarChart3, Briefcase, Eye, TrendingUp, Users } from "lucide-react";
import { EmployerShell, StatCard } from "@/components/employer/EmployerShell";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyCompanies, getActiveCompanyId } from "@/lib/employer";
import { getEmployerAnalytics, type EmployerAnalytics } from "@/lib/employer-analytics.functions";

export const Route = createFileRoute("/_authenticated/employer/reports")({
  head: () => ({ meta: [{ title: "Reports · JobsKart Employer" }] }),
  component: ReportsPage,
});

function ReportsPage() {
  const [cid, setCid] = useState<string | null>(null);
  const [range, setRange] = useState<7 | 30 | 90>(30);
  const [data, setData] = useState<EmployerAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchAnalytics = useServerFn(getEmployerAnalytics);

  useEffect(() => {
    (async () => {
      let id = getActiveCompanyId();
      if (!id) {
        const { data: u } = await supabase.auth.getUser();
        if (u.user) {
          const ms = await fetchMyCompanies(u.user.id);
          id = ms[0]?.company_id ?? null;
        }
      }
      setCid(id);
    })();
  }, []);

  useEffect(() => {
    if (!cid) return;
    setLoading(true);
    fetchAnalytics({ data: { companyId: cid, rangeDays: range } })
      .then((r) => setData(r as EmployerAnalytics))
      .finally(() => setLoading(false));
  }, [cid, range, fetchAnalytics]);

  if (loading || !data) {
    return (
      <EmployerShell title="Reports">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-card" />
          ))}
        </div>
        <div className="mt-6 h-64 animate-pulse rounded-2xl bg-card" />
      </EmployerShell>
    );
  }

  const max = Math.max(data.funnel.applied, 1);
  const stages: Array<[string, number]> = [
    ["Applied", data.funnel.applied],
    ["Shortlisted", data.funnel.shortlisted],
    ["Interview", data.funnel.interview],
    ["Hired", data.funnel.hired],
    ["Rejected", data.funnel.rejected + data.funnel.withdrawn],
  ];

  const maxDay = Math.max(...data.daily.map((d) => d.applications), 1);
  const empty = data.totals.jobs === 0;

  return (
    <EmployerShell
      title="Reports"
      subtitle="Hiring performance with real data, refreshed live."
      actions={
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
          {([7, 30, 90] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                range === r ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:bg-surface"
              }`}
            >{r}d</button>
          ))}
        </div>
      }
    >
      {empty ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface p-10 text-center">
          <BarChart3 className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
          <p className="text-sm font-semibold">Post your first job to see analytics</p>
          <p className="mt-1 text-xs text-muted-foreground">Views, applications, and pipeline metrics show up here.</p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            <StatCard label="Active jobs" value={data.totals.activeJobs} tone="primary" hint={`${data.totals.jobs} total`} />
            <StatCard label="Applications" value={data.totals.applications} tone="success" delta={data.deltas.applications} hint={`Last ${range}d`} />
            <StatCard label="Job views" value={data.totals.views} tone="muted" hint="All time" />
            <StatCard label="Conversion" value={`${data.conversionRate}%`} tone="warning" hint="Apply / view" />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <section className="lg:col-span-2 rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
              <div className="mb-4 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                <h2 className="text-base font-bold">Applications · last {range} days</h2>
              </div>
              <div className="flex h-32 items-end gap-0.5">
                {data.daily.map((d) => (
                  <div key={d.date} className="group relative flex-1">
                    <div
                      className="w-full rounded-t bg-primary/80 transition-colors hover:bg-primary"
                      style={{ height: `${(d.applications / maxDay) * 100}%`, minHeight: d.applications ? "2px" : "0" }}
                      title={`${d.date}: ${d.applications}`}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
                <span>{data.daily[0]?.date.slice(5)}</span>
                <span>{data.daily[data.daily.length - 1]?.date.slice(5)}</span>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
              <div className="mb-4 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                <h2 className="text-base font-bold">Pipeline</h2>
              </div>
              <div className="space-y-3">
                {stages.map(([label, value]) => (
                  <div key={label}>
                    <div className="mb-1 flex items-center justify-between text-xs font-semibold text-muted-foreground">
                      <span>{label}</span>
                      <span className="tabular-nums text-foreground">{value}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-surface">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((value / max) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
            <div className="mb-3 flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-primary" />
              <h2 className="text-base font-bold">Top performing jobs</h2>
            </div>
            <ul className="divide-y divide-border">
              {data.topJobs.map((j) => (
                <li key={j.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{j.title}</p>
                    <p className="text-[11px] text-muted-foreground">Status: {j.status}</p>
                  </div>
                  <div className="flex shrink-0 gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Eye className="h-3.5 w-3.5" /><span className="tabular-nums text-foreground">{j.views}</span></span>
                    <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /><span className="tabular-nums text-foreground">{j.applications}</span></span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </EmployerShell>
  );
}
