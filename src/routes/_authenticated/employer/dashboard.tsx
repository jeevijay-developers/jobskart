import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Briefcase, Eye, FileText, Plus, ShieldAlert, ShieldCheck, Users } from "lucide-react";
import { EmployerShell, StatCard } from "@/components/employer/EmployerShell";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyCompanies, getActiveCompanyId, setActiveCompanyId, type EmployerMembership } from "@/lib/employer";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/employer/dashboard")({
  head: () => ({ meta: [{ title: "Employer Dashboard · JobsKart" }] }),
  component: EmployerDashboard,
});

type DashStats = {
  activeJobs: number;
  totalApplications: number;
  thisWeek: number;
  interviews: number;
  views: number;
};

type RecentApp = {
  id: string;
  status: string;
  created_at: string;
  jobs: { title: string; id: string } | null;
  profiles: { full_name: string | null; avatar_url: string | null } | null;
};

function EmployerDashboard() {
  const [companies, setCompanies] = useState<EmployerMembership[]>([]);
  const [active, setActive] = useState<EmployerMembership | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashStats>({ activeJobs: 0, totalApplications: 0, thisWeek: 0, interviews: 0, views: 0 });
  const [recent, setRecent] = useState<RecentApp[]>([]);

  useEffect(() => {
    (async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return;
      const ms = await fetchMyCompanies(user.user.id);
      setCompanies(ms);
      const storedId = getActiveCompanyId();
      const chosen = ms.find((m) => m.company_id === storedId) ?? ms[0] ?? null;
      if (chosen) setActiveCompanyId(chosen.company_id);
      setActive(chosen);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!active) return;
    (async () => {
      const cid = active.company_id;
      const weekAgo = new Date(Date.now() - 7 * 86400e3).toISOString();
      const [jobsRes, jobsList] = await Promise.all([
        supabase.from("jobs").select("id, applications_count, views_count, status").eq("company_id", cid),
        supabase.from("jobs").select("id").eq("company_id", cid),
      ]);
      const jobs = jobsRes.data || [];
      const jobIds = (jobsList.data || []).map((j) => j.id);
      const [appsAll, appsWeek, interviews, recentRes] = await Promise.all([
        supabase.from("applications").select("id", { count: "exact", head: true }).in("job_id", jobIds.length ? jobIds : ["00000000-0000-0000-0000-000000000000"]),
        supabase.from("applications").select("id", { count: "exact", head: true }).in("job_id", jobIds.length ? jobIds : ["00000000-0000-0000-0000-000000000000"]).gte("created_at", weekAgo),
        supabase.from("applications").select("id", { count: "exact", head: true }).in("job_id", jobIds.length ? jobIds : ["00000000-0000-0000-0000-000000000000"]).eq("status", "interview"),
        supabase.from("applications").select("id, status, created_at, jobs!inner (id, title, company_id), profiles!applications_candidate_id_fkey (full_name, avatar_url)").eq("jobs.company_id", cid).order("created_at", { ascending: false }).limit(8),
      ]);
      setStats({
        activeJobs: jobs.filter((j) => j.status === "active").length,
        totalApplications: appsAll.count || 0,
        thisWeek: appsWeek.count || 0,
        interviews: interviews.count || 0,
        views: jobs.reduce((a, b) => a + (b.views_count || 0), 0),
      });
      setRecent((recentRes.data || []) as unknown as RecentApp[]);
    })();
  }, [active]);

  if (loading) return <EmployerShell title="Loading…"><div className="h-40 animate-pulse rounded-xl bg-card" /></EmployerShell>;

  if (!active) {
    return (
      <EmployerShell title="Welcome to JobsKart">
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <h2 className="text-lg font-bold">Let's set up your company</h2>
          <p className="mt-1 text-sm text-muted-foreground">Add your company details to start posting jobs and receiving applications.</p>
          <Link to="/onboarding/employer" className="mt-4 inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-dark">
            Set up company
          </Link>
        </div>
      </EmployerShell>
    );
  }

  const verified = active.companies.verification_status === "verified";

  return (
    <EmployerShell
      title={`Welcome, ${active.companies.name}`}
      subtitle="Here's what's happening with your hiring today."
      actions={
        companies.length > 1 && (
          <select
            className="form-input h-10 text-sm"
            value={active.company_id}
            onChange={(e) => {
              const next = companies.find((c) => c.company_id === e.target.value);
              if (next) { setActive(next); setActiveCompanyId(next.company_id); }
            }}
          >
            {companies.map((c) => <option key={c.company_id} value={c.company_id}>{c.companies.name}</option>)}
          </select>
        )
      }
    >
      {!verified && (
        <div className="mb-6 flex items-start justify-between gap-4 rounded-xl border border-warning/30 bg-warning-light p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 text-warning" />
            <div>
              <p className="font-semibold text-foreground">Verify your company</p>
              <p className="text-sm text-muted-foreground">Upload GST or PAN to get a verified badge — candidates trust verified employers 4× more.</p>
            </div>
          </div>
          <Link to="/employer/company" className="shrink-0 rounded-lg bg-warning px-3 py-2 text-sm font-semibold text-warning-foreground">
            Verify now
          </Link>
        </div>
      )}
      {verified && (
        <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-success-light px-3 py-1.5 text-sm font-medium text-success">
          <ShieldCheck className="h-4 w-4" /> Company verified
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Active jobs" value={stats.activeJobs} hint={stats.activeJobs > 0 ? "Live now" : "Post your first"} />
        <StatCard label="Total applicants" value={stats.totalApplications} tone="primary" />
        <StatCard label="This week" value={stats.thisWeek} hint={`+${stats.thisWeek} new`} tone="success" />
        <StatCard label="In interview" value={stats.interviews} tone="warning" />
        <StatCard label="Job views" value={stats.views} tone="muted" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Recent applicants</h2>
            <Link to="/employer/jobs" className="text-xs font-semibold text-primary">View all jobs</Link>
          </div>
          <div className="mt-4 divide-y divide-border">
            {recent.length === 0 ? (
              <p className="rounded-lg bg-surface px-4 py-8 text-center text-sm text-muted-foreground">No applicants yet — post a job to start receiving applications.</p>
            ) : recent.map((a) => (
              <Link
                key={a.id}
                to="/employer/jobs/$jobId/applicants"
                params={{ jobId: a.jobs?.id || "" }}
                className="flex items-center justify-between gap-3 py-3 hover:bg-surface"
              >
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-primary-light text-sm font-semibold text-primary">
                    {(a.profiles?.full_name || "?").slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.profiles?.full_name || "Candidate"}</p>
                    <p className="truncate text-xs text-muted-foreground">{a.jobs?.title}</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="rounded-full bg-primary-light px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">{a.status}</span>
                  <p className="mt-1 text-[10px] text-muted-foreground">{formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <Link to="/employer/jobs/new" className="flex items-center gap-3 rounded-xl border border-border bg-gradient-to-br from-primary to-primary-dark p-4 text-primary-foreground hover:opacity-90">
            <Plus className="h-6 w-6" />
            <div>
              <p className="font-semibold">Post a new job</p>
              <p className="text-xs opacity-80">4-step wizard</p>
            </div>
          </Link>
          <Link to="/employer/jobs" className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 hover:bg-surface">
            <Briefcase className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-semibold">Manage jobs</p>
              <p className="text-xs text-muted-foreground">{stats.activeJobs} active</p>
            </div>
          </Link>
          <Link to="/employer/team" className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 hover:bg-surface">
            <Users className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-semibold">Invite teammates</p>
              <p className="text-xs text-muted-foreground">Manage your team</p>
            </div>
          </Link>
          <Link to="/employer/company" className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 hover:bg-surface">
            <FileText className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-semibold">Company profile</p>
              <p className="text-xs text-muted-foreground">KYC & branding</p>
            </div>
          </Link>
        </div>
      </div>

      {stats.activeJobs === 0 && (
        <div className="mt-6 rounded-2xl border-2 border-dashed border-border bg-card p-8 text-center">
          <Eye className="mx-auto h-10 w-10 text-muted-foreground" />
          <h3 className="mt-3 text-lg font-bold">Post your first job to get discovered</h3>
          <p className="mt-1 text-sm text-muted-foreground">Free to post · Reach 50 lakh+ candidates across India</p>
          <Link to="/employer/jobs/new" className="mt-4 inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary-dark">
            <Plus className="h-4 w-4" /> Post a job
          </Link>
        </div>
      )}
    </EmployerShell>
  );
}
