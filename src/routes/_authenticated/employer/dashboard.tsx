import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Briefcase,
  Database,
  Eye,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Users,
  Building2,
  Image as ImageIcon,
  FileText,
  GraduationCap,
  ArrowRight,
  ChevronRight,
  Activity as ActivityIcon,
} from "lucide-react";
import { ActivityFeed, type ActivityItem } from "@/components/employer/ActivityFeed";
import { EmployerShell, StatCard } from "@/components/employer/EmployerShell";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchMyCompanies,
  getActiveCompanyId,
  setActiveCompanyId,
  type EmployerMembership,
} from "@/lib/employer";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/employer/dashboard")({
  head: () => ({ meta: [{ title: "Employer Dashboard · JobsKart" }] }),
  component: EmployerDashboard,
});

type DashStats = {
  activeJobs: number;
  totalApplications: number;
  thisWeek: number;
  lastWeek: number;
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

type TopJob = {
  id: string;
  title: string;
  status: string;
  applications_count: number | null;
  views_count: number | null;
};

type CompanyMeta = {
  about: string | null;
  logo_url: string | null;
  gst_number: string | null;
};

type Learn = { id: string; title: string; slug: string; cover_url: string | null; kind: string; category: string | null };

const FUNNEL = [
  { id: "applied", label: "Applied", color: "bg-primary" },
  { id: "shortlisted", label: "Shortlisted", color: "bg-success" },
  { id: "interview", label: "Interview", color: "bg-warning" },
  { id: "hired", label: "Hired", color: "bg-emerald-600" },
] as const;

function EmployerDashboard() {
  const [companies, setCompanies] = useState<EmployerMembership[]>([]);
  const [active, setActive] = useState<EmployerMembership | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashStats>({
    activeJobs: 0, totalApplications: 0, thisWeek: 0, lastWeek: 0, interviews: 0, views: 0,
  });
  const [recent, setRecent] = useState<RecentApp[]>([]);
  const [topJobs, setTopJobs] = useState<TopJob[]>([]);
  const [funnel, setFunnel] = useState<Record<string, number>>({});
  const [companyMeta, setCompanyMeta] = useState<CompanyMeta | null>(null);
  const [teamCount, setTeamCount] = useState(0);
  const [learn, setLearn] = useState<Learn[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);

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
      const now = Date.now();
      const weekAgo = new Date(now - 7 * 86400e3).toISOString();
      const twoWeekAgo = new Date(now - 14 * 86400e3).toISOString();

      const [jobsRes, recentRes, cMeta, tCount, learnRes] = await Promise.all([
        supabase
          .from("jobs")
          .select("id, title, status, applications_count, views_count")
          .eq("company_id", cid)
          .order("applications_count", { ascending: false }),
        supabase
          .from("applications")
          .select("id, status, created_at, jobs!inner (id, title, company_id), profiles!applications_candidate_id_fkey (full_name, avatar_url)")
          .eq("jobs.company_id", cid)
          .order("created_at", { ascending: false })
          .limit(8),
        supabase.from("companies").select("about, logo_url, gst_number").eq("id", cid).maybeSingle(),
        supabase.from("employer_members").select("user_id", { count: "exact", head: true }).eq("company_id", cid),
        supabase
          .from("learning_resources")
          .select("id, title, slug, cover_url, kind, category")
          .eq("is_published", true)
          .order("created_at", { ascending: false })
          .limit(3),
      ]);

      const jobs = jobsRes.data || [];
      const jobIds = jobs.map((j) => j.id);
      const safeIds = jobIds.length ? jobIds : ["00000000-0000-0000-0000-000000000000"];

      const [appsAll, appsWeek, appsPrev, interviews, fApplied, fShort, fInt, fHired] = await Promise.all([
        supabase.from("applications").select("id", { count: "exact", head: true }).in("job_id", safeIds),
        supabase.from("applications").select("id", { count: "exact", head: true }).in("job_id", safeIds).gte("created_at", weekAgo),
        supabase.from("applications").select("id", { count: "exact", head: true }).in("job_id", safeIds).gte("created_at", twoWeekAgo).lt("created_at", weekAgo),
        supabase.from("applications").select("id", { count: "exact", head: true }).in("job_id", safeIds).eq("status", "interview"),
        supabase.from("applications").select("id", { count: "exact", head: true }).in("job_id", safeIds).eq("status", "applied"),
        supabase.from("applications").select("id", { count: "exact", head: true }).in("job_id", safeIds).eq("status", "shortlisted"),
        supabase.from("applications").select("id", { count: "exact", head: true }).in("job_id", safeIds).eq("status", "interview"),
        supabase.from("applications").select("id", { count: "exact", head: true }).in("job_id", safeIds).eq("status", "hired"),
      ]);

      setStats({
        activeJobs: jobs.filter((j) => j.status === "active").length,
        totalApplications: appsAll.count || 0,
        thisWeek: appsWeek.count || 0,
        lastWeek: appsPrev.count || 0,
        interviews: interviews.count || 0,
        views: jobs.reduce((a, b) => a + (b.views_count || 0), 0),
      });
      setFunnel({
        applied: fApplied.count || 0,
        shortlisted: fShort.count || 0,
        interview: fInt.count || 0,
        hired: fHired.count || 0,
      });
      setRecent((recentRes.data || []) as unknown as RecentApp[]);
      setTopJobs(jobs.slice(0, 5) as TopJob[]);
      setCompanyMeta((cMeta.data as CompanyMeta) ?? null);
      setTeamCount(tCount.count ?? 0);
      setLearn((learnRes.data || []) as Learn[]);

      setActivityLoading(true);
      const { data: act } = await supabase
        .from("employer_activity")
        .select("id, kind, title, body, link, created_at, metadata")
        .eq("company_id", cid)
        .order("created_at", { ascending: false })
        .limit(10);
      setActivity((act || []) as ActivityItem[]);
      setActivityLoading(false);
    })();
  }, [active]);

  if (loading) {
    return (
      <EmployerShell title="Loading…">
        <div className="h-40 animate-pulse rounded-xl bg-card" />
      </EmployerShell>
    );
  }

  if (!active) {
    return (
      <EmployerShell title="Welcome to JobsKart">
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <h2 className="text-lg font-bold">Let's set up your company</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Add your company details to start posting jobs and receiving applications.
          </p>
          <Link
            to="/onboarding/employer"
            className="mt-4 inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-dark"
          >
            Set up company
          </Link>
        </div>
      </EmployerShell>
    );
  }

  const verified = active.companies.verification_status === "verified";
  const delta = stats.thisWeek - stats.lastWeek;

  const kyc = [
    { done: !!companyMeta?.logo_url, label: "Upload company logo", to: "/employer/company", icon: ImageIcon },
    { done: !!(companyMeta?.about && companyMeta.about.length > 40), label: "Add company about (40+ chars)", to: "/employer/company", icon: FileText },
    { done: !!companyMeta?.gst_number || verified, label: "Verify GST / get verified badge", to: "/employer/company", icon: ShieldCheck },
    { done: teamCount > 1, label: "Invite a teammate", to: "/employer/team", icon: Users },
  ];
  const kycDone = kyc.filter((k) => k.done).length;

  return (
    <EmployerShell
      title="Employer dashboard"
      actions={
        companies.length > 1 && (
          <select
            className="form-input h-9 text-sm"
            value={active.company_id}
            onChange={(e) => {
              const next = companies.find((c) => c.company_id === e.target.value);
              if (next) { setActive(next); setActiveCompanyId(next.company_id); }
            }}
          >
            {companies.map((c) => (
              <option key={c.company_id} value={c.company_id}>
                {c.companies.name}
              </option>
            ))}
          </select>
        )
      }
    >
      {/* HERO */}
      <section className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-primary via-primary to-primary-dark p-6 text-primary-foreground shadow-[var(--shadow-elegant)] sm:p-8">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-white/10 blur-3xl"
        />
        <div className="relative grid gap-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="flex min-w-0 items-center gap-4">
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-white/15 text-2xl font-black ring-1 ring-white/20 sm:h-20 sm:w-20 sm:text-3xl">
              {active.companies.logo_url ? (
                <img src={active.companies.logo_url} alt="" className="h-full w-full rounded-2xl object-cover" />
              ) : (
                active.companies.name.slice(0, 1).toUpperCase()
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/70">Welcome back</p>
              <h2 className="mt-1 truncate text-2xl font-black sm:text-3xl">{active.companies.name}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                {verified ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 font-semibold ring-1 ring-white/25">
                    <ShieldCheck className="h-3 w-3" /> Verified employer
                  </span>
                ) : (
                  <Link
                    to="/employer/company"
                    className="inline-flex items-center gap-1 rounded-full bg-warning/90 px-2.5 py-1 font-semibold text-warning-foreground hover:bg-warning"
                  >
                    <ShieldAlert className="h-3 w-3" /> Verify your company
                  </Link>
                )}
                {active.companies.industry && (
                  <span className="rounded-full bg-white/10 px-2.5 py-1 ring-1 ring-white/15">
                    {active.companies.industry}
                  </span>
                )}
                {active.companies.hq_city && (
                  <span className="rounded-full bg-white/10 px-2.5 py-1 ring-1 ring-white/15">
                    {active.companies.hq_city}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Link
              to="/employer/jobs/new"
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-primary shadow hover:bg-white/90"
            >
              <Plus className="h-4 w-4" /> Post a job
            </Link>
            <Link
              to="/employer/database"
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/30 bg-white/10 px-4 text-sm font-semibold text-white hover:bg-white/15"
            >
              <Database className="h-4 w-4" /> Search candidates
            </Link>
          </div>
        </div>
      </section>

      {/* STATS */}
      <div className="mt-6 grid gap-4 grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="Active jobs"
          value={stats.activeJobs}
          hint={stats.activeJobs > 0 ? "Live now" : "Post your first"}
        />
        <StatCard label="Total applicants" value={stats.totalApplications} tone="primary" />
        <StatCard
          label="This week"
          value={stats.thisWeek}
          delta={delta}
          tone="success"
          hint={delta >= 0 ? "vs last week" : "vs last week"}
        />
        <StatCard label="In interview" value={stats.interviews} tone="warning" />
        <StatCard label="Job views" value={stats.views} tone="muted" />
      </div>

      {/* PIPELINE + SIDEBAR */}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Pipeline */}
          <section className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold">Hiring pipeline</h2>
              <Link to="/employer/reports" className="text-xs font-semibold text-primary">Full report →</Link>
            </div>
            <div className="overflow-x-auto">
              <div className="flex min-w-[560px] gap-2">
                {FUNNEL.map((s, i) => {
                  const v = funnel[s.id] ?? 0;
                  const max = Math.max(...FUNNEL.map((f) => funnel[f.id] ?? 0), 1);
                  return (
                    <div key={s.id} className="flex-1">
                      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        <span className={`h-2 w-2 rounded-full ${s.color}`} />
                        {s.label}
                      </div>
                      <div className="rounded-xl bg-surface p-3 ring-1 ring-border">
                        <p className="text-2xl font-black text-foreground tabular-nums">{v}</p>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-card">
                          <div
                            className={`h-full rounded-full ${s.color}`}
                            style={{ width: `${Math.round((v / max) * 100)}%` }}
                          />
                        </div>
                      </div>
                      {i < FUNNEL.length - 1 && (
                        <p className="mt-1 text-center text-[10px] text-muted-foreground">
                          {v && (funnel[FUNNEL[i + 1].id] ?? 0)
                            ? `${Math.round(((funnel[FUNNEL[i + 1].id] ?? 0) / v) * 100)}% next`
                            : "—"}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Activity feed */}
          <section className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-base font-bold"><ActivityIcon className="h-4 w-4 text-primary" /> Activity</h2>
              <Link to="/employer/activity" className="text-xs font-semibold text-primary">View all →</Link>
            </div>
            <ActivityFeed items={activity} loading={activityLoading} />
          </section>

          {/* Recent applicants */}
          <section className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold">Recent applicants</h2>
              <Link to="/employer/responses" className="text-xs font-semibold text-primary">Open inbox →</Link>
            </div>
            <div className="mt-4 divide-y divide-border">
              {recent.length === 0 ? (
                <p className="rounded-lg bg-surface px-4 py-8 text-center text-sm text-muted-foreground">
                  No applicants yet — post a job to start receiving applications.
                </p>
              ) : (
                recent.map((a) => (
                  <Link
                    key={a.id}
                    to="/employer/jobs/$jobId/applicants"
                    params={{ jobId: a.jobs?.id || "" }}
                    className="flex items-center justify-between gap-3 py-3 hover:bg-surface"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-light text-sm font-semibold text-primary">
                        {(a.profiles?.full_name || "?").slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{a.profiles?.full_name || "Candidate"}</p>
                        <p className="truncate text-xs text-muted-foreground">{a.jobs?.title}</p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="rounded-full bg-primary-light px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">
                        {a.status}
                      </span>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                      </p>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </section>
        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-6">
          {/* Top jobs */}
          <section className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold">Top performing jobs</h2>
              <Link to="/employer/jobs" className="text-xs font-semibold text-primary">All →</Link>
            </div>
            {topJobs.length === 0 ? (
              <p className="rounded-lg bg-surface px-3 py-6 text-center text-xs text-muted-foreground">No jobs posted yet</p>
            ) : (
              <ul className="space-y-2">
                {topJobs.map((j) => (
                  <li key={j.id}>
                    <Link
                      to="/employer/jobs/$jobId/applicants"
                      params={{ jobId: j.id }}
                      className="flex items-center justify-between gap-2 rounded-lg p-2 hover:bg-surface"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{j.title}</p>
                        <p className="text-[11px] text-muted-foreground">
                          <Eye className="mr-0.5 inline h-3 w-3" />
                          {j.views_count || 0} · <Users className="mx-0.5 inline h-3 w-3" />
                          {j.applications_count || 0} applied
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* KYC checklist */}
          <section className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold">Set up checklist</h2>
              <span className="text-xs font-semibold text-muted-foreground tabular-nums">
                {kycDone}/{kyc.length}
              </span>
            </div>
            <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface">
              <div className="h-full rounded-full bg-primary" style={{ width: `${(kycDone / kyc.length) * 100}%` }} />
            </div>
            <ul className="space-y-1">
              {kyc.map((k) => {
                const Icon = k.icon;
                return (
                  <li key={k.label}>
                    <Link
                      to={k.to}
                      className={`flex items-center gap-3 rounded-lg p-2 text-sm transition-colors ${
                        k.done ? "text-muted-foreground line-through" : "text-foreground hover:bg-surface"
                      }`}
                    >
                      <span
                        className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${
                          k.done ? "bg-success-light text-success" : "bg-primary-light text-primary"
                        }`}
                      >
                        {k.done ? <ShieldCheck className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                      </span>
                      <span className="flex-1">{k.label}</span>
                      {!k.done && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Learning */}
          {learn.length > 0 && (
            <section className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
              <div className="mb-3 flex items-center gap-2">
                <GraduationCap className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-bold">Hire smarter</h2>
              </div>
              <ul className="space-y-2">
                {learn.map((l) => (
                  <li key={l.id}>
                    <a
                      href={`/learn/${l.slug}`}
                      className="flex items-center gap-3 rounded-lg p-2 hover:bg-surface"
                    >
                      <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-primary-light text-primary">
                        {l.cover_url ? (
                          <img src={l.cover_url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <FileText className="h-4 w-4" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{l.title}</p>
                        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{l.kind} · {l.category || "Tips"}</p>
                      </div>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      {/* Empty state */}
      {stats.activeJobs === 0 && (
        <div className="mt-6 rounded-2xl border-2 border-dashed border-border bg-card p-8 text-center">
          <Briefcase className="mx-auto h-10 w-10 text-muted-foreground" />
          <h3 className="mt-3 text-lg font-bold">Post your first job to get discovered</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Free to post · Reach 50 lakh+ candidates across India
          </p>
          <Link
            to="/employer/jobs/new"
            className="mt-4 inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary-dark"
          >
            <Plus className="h-4 w-4" /> Post a job
          </Link>
        </div>
      )}

      {/* Hidden building icon usage to keep import */}
      <Building2 className="hidden" />
    </EmployerShell>
  );
}
