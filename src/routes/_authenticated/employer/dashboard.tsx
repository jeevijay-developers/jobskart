import { ThemedSelect } from "@/components/ui/themed-form-controls";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
  ChevronRight,
  Activity as ActivityIcon,
  CalendarCheck2,
  Check,
} from "lucide-react";
import { ActivityFeed, type ActivityItem } from "@/components/employer/ActivityFeed";
import { EmployerShell } from "@/components/employer/EmployerShell";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchMyCompanies,
  getActiveCompanyId,
  setActiveCompanyId,
  type EmployerMembership,
} from "@/lib/employer";
import { formatDistanceToNow } from "date-fns";
import { useBackToHome } from "@/hooks/use-back-to-home";
import { applicantStatusLabel, applicantStatusTone } from "@/lib/applicantStatus";

export const Route = createFileRoute("/_authenticated/employer/dashboard")({
  head: () => ({ meta: [{ title: "Employer Dashboard · JobsKart" }] }),
  component: EmployerDashboard,
});

type DashStats = {
  activeJobs: number;
  totalApplications: number;
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
};

type Learn = {
  id: string;
  title: string;
  slug: string;
  cover_url: string | null;
  kind: string;
  category: string | null;
};

const metricTones = {
  primary: "bg-primary-light text-primary",
  success: "bg-success-light text-success",
  warning: "bg-warning-light text-warning",
  muted: "bg-surface text-muted-foreground",
};

function DashboardMetricCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: typeof Briefcase;
  label: string;
  value: number;
  hint?: string;
  tone: keyof typeof metricTones;
}) {
  return (
    <div className="group flex min-h-32 min-w-0 flex-col justify-between rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)] transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)] sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </p>
        <span
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${metricTones[tone]}`}
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-5 flex min-w-0 items-end justify-between gap-2">
        <p className="text-3xl font-black leading-none tracking-tight text-foreground tabular-nums sm:text-4xl">
          {value}
        </p>
        {hint ? (
          <span
            className={`truncate rounded-full px-2.5 py-1 text-[11px] font-semibold ${metricTones[tone]}`}
          >
            {hint}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function EmployerDashboard() {
  const navigate = useNavigate();
  useBackToHome();
  const [companies, setCompanies] = useState<EmployerMembership[]>([]);
  const [active, setActive] = useState<EmployerMembership | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashStats>({
    activeJobs: 0,
    totalApplications: 0,
    interviews: 0,
    views: 0,
  });
  const [recent, setRecent] = useState<RecentApp[]>([]);
  const [topJobs, setTopJobs] = useState<TopJob[]>([]);
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
      if (ms.length === 0) {
        navigate({ to: "/onboarding/employer" });
        return;
      }
      setCompanies(ms);
      const storedId = getActiveCompanyId();
      const chosen = ms.find((m) => m.company_id === storedId) ?? ms[0] ?? null;
      if (chosen) setActiveCompanyId(chosen.company_id);
      setActive(chosen);
      setLoading(false);
    })();
  }, [navigate]);

  useEffect(() => {
    if (!active) return;
    (async () => {
      const cid = active.company_id;

      const [jobsRes, recentRes, cMeta, tCount, learnRes] = await Promise.all([
        supabase
          .from("jobs")
          .select("id, title, status, applications_count, views_count")
          .eq("company_id", cid)
          .order("applications_count", { ascending: false }),
        supabase
          .from("applications")
          .select(
            "id, status, created_at, jobs!inner (id, title, company_id), profiles!candidate_id (full_name, avatar_url)",
          )
          .eq("jobs.company_id", cid)
          .order("created_at", { ascending: false })
          .limit(8),
        supabase.from("companies").select("about, logo_url").eq("id", cid).maybeSingle(),
        supabase
          .from("employer_members")
          .select("user_id", { count: "exact", head: true })
          .eq("company_id", cid),
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

      const [appsAll, interviews] = await Promise.all([
        supabase
          .from("applications")
          .select("id", { count: "exact", head: true })
          .in("job_id", safeIds),
        supabase
          .from("applications")
          .select("id", { count: "exact", head: true })
          .in("job_id", safeIds)
          .eq("status", "interview"),
      ]);

      setStats({
        activeJobs: jobs.filter((j) => j.status === "active").length,
        totalApplications: appsAll.count || 0,
        interviews: interviews.count || 0,
        views: jobs.reduce((a, b) => a + (b.views_count || 0), 0),
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
  const roleLabel = active.role.replaceAll("_", " ");

  const kyc = [
    {
      done: !!companyMeta?.logo_url,
      label: "Upload company logo",
      to: "/employer/company",
      icon: ImageIcon,
    },
    {
      done: !!(companyMeta?.about && companyMeta.about.length > 40),
      label: "Add company about (40+ chars)",
      to: "/employer/company",
      icon: FileText,
    },
    {
      done: verified,
      label: "Verify GST / get verified badge",
      to: "/employer/company",
      icon: ShieldCheck,
    },
    { done: teamCount > 1, label: "Invite a teammate", to: "/employer/team", icon: Users },
  ];
  const kycDone = kyc.filter((k) => k.done).length;

  return (
    <EmployerShell
      title="Employer dashboard"
      actions={
        companies.length > 1 && (
          <ThemedSelect
            className="form-input h-9 w-full max-w-[220px] text-sm sm:w-auto"
            value={active.company_id}
            onChange={(e) => {
              const next = companies.find((c) => c.company_id === e.target.value);
              if (next) {
                setActive(next);
                setActiveCompanyId(next.company_id);
              }
            }}
          >
            {companies.map((c) => (
              <option key={c.company_id} value={c.company_id}>
                {c.companies.name}
              </option>
            ))}
          </ThemedSelect>
        )
      }
    >
      <div className="space-y-5 sm:space-y-6">
        {/* Company overview */}
        <section className="relative overflow-hidden rounded-[1.75rem] border border-border bg-card shadow-[var(--shadow-card)]">
          <div aria-hidden className="absolute inset-y-0 left-0 w-1.5 bg-primary" />
          <div
            aria-hidden
            className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary-light blur-3xl"
          />
          <div className="relative grid gap-6 p-5 sm:p-6 min-[1180px]:grid-cols-[minmax(0,1fr)_auto] min-[1180px]:items-center min-[1180px]:p-7">
            <div className="flex min-w-0 items-center gap-4 sm:gap-5">
              <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl border border-primary/10 bg-primary-light text-xl font-black text-primary shadow-sm sm:h-20 sm:w-20 sm:text-2xl">
                {active.companies.logo_url ? (
                  <img
                    src={active.companies.logo_url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  active.companies.name.slice(0, 1).toUpperCase()
                )}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Welcome back
                </p>
                <h2 className="mt-1 break-words text-2xl font-black leading-tight tracking-tight text-foreground sm:truncate sm:text-3xl">
                  {active.companies.name}
                </h2>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-light px-2.5 py-1 font-semibold capitalize text-primary">
                    <ShieldCheck className="h-3 w-3" /> {roleLabel}
                  </span>
                  {verified ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-success-light px-2.5 py-1 font-semibold text-success">
                      <ShieldCheck className="h-3 w-3" /> Verified employer
                    </span>
                  ) : (
                    <Link
                      to="/employer/company"
                      className="inline-flex items-center gap-1.5 rounded-full bg-warning-light px-2.5 py-1 font-semibold text-warning hover:bg-warning/15"
                    >
                      <ShieldAlert className="h-3 w-3" /> Verify your company
                    </Link>
                  )}
                  {active.companies.industry && (
                    <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-muted-foreground">
                      {active.companies.industry}
                    </span>
                  )}
                  {active.companies.hq_city && (
                    <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-muted-foreground">
                      {active.companies.hq_city}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:flex sm:shrink-0 sm:flex-wrap min-[1180px]:justify-end">
              <Link
                to="/employer/jobs/new"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-3.5 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary-dark sm:px-4"
              >
                <Plus className="h-4 w-4 shrink-0" /> <span className="truncate">Post a job</span>
              </Link>
              <Link
                to="/employer/database"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3.5 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-surface sm:px-4"
              >
                <Database className="h-4 w-4 shrink-0" />{" "}
                <span className="truncate">Search candidates</span>
              </Link>
            </div>
          </div>
        </section>

        {/* Summary metrics */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 min-[1180px]:grid-cols-4">
          <DashboardMetricCard
            icon={Briefcase}
            label="Active jobs"
            value={stats.activeJobs}
            hint={stats.activeJobs > 0 ? "Live now" : "Post your first"}
            tone="success"
          />
          <DashboardMetricCard
            icon={Users}
            label="Total applicants"
            value={stats.totalApplications}
            tone="primary"
          />
          <DashboardMetricCard
            icon={CalendarCheck2}
            label="In interview"
            value={stats.interviews}
            tone="warning"
          />
          <DashboardMetricCard icon={Eye} label="Job views" value={stats.views} tone="muted" />
        </div>

        {/* Primary workspace and supporting rail */}
        <div className="grid min-w-0 items-start gap-5 sm:gap-6 min-[1180px]:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
          <div className="min-w-0">
            <section className="min-w-0 overflow-hidden rounded-[1.375rem] border border-border bg-card shadow-[var(--shadow-card)]">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
                <h2 className="flex min-w-0 items-center gap-2.5 text-base font-bold">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary-light text-primary">
                    <ActivityIcon className="h-4 w-4" />
                  </span>
                  <span className="truncate">Activity</span>
                </h2>
                <Link
                  to="/employer/activity"
                  className="inline-flex h-8 shrink-0 items-center rounded-lg px-2.5 text-xs font-semibold text-primary transition-colors hover:bg-primary-light"
                >
                  View all →
                </Link>
              </div>
              <div className="p-4 sm:p-6">
                <ActivityFeed items={activity} loading={activityLoading} />
              </div>
            </section>
          </div>

          <aside className="min-w-0 space-y-5 sm:space-y-6">
            <section className="overflow-hidden rounded-[1.375rem] border border-border bg-card shadow-[var(--shadow-card)]">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
                <h2 className="flex min-w-0 items-center gap-2 text-sm font-bold">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary-light text-primary">
                    <Briefcase className="h-4 w-4" />
                  </span>
                  <span className="truncate">Top performing jobs</span>
                </h2>
                <Link
                  to="/employer/jobs"
                  className="inline-flex h-8 shrink-0 items-center rounded-lg px-2 text-xs font-semibold text-primary hover:bg-primary-light"
                >
                  All →
                </Link>
              </div>
              <div className="p-3 sm:p-4">
                {topJobs.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border bg-surface px-3 py-7 text-center text-xs text-muted-foreground">
                    No jobs posted yet
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {topJobs.map((j) => (
                      <li key={j.id}>
                        <Link
                          to="/employer/jobs/$jobId/applicants"
                          params={{ jobId: j.id }}
                          className="flex items-center justify-between gap-2 rounded-xl px-2.5 py-3 transition-colors hover:bg-surface"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{j.title}</p>
                            <p className="mt-1 text-[11px] text-muted-foreground">
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
              </div>
            </section>

            {/* KYC checklist — hidden once all steps are actually complete */}
            {kycDone < kyc.length && (
              <section className="overflow-hidden rounded-[1.375rem] border border-border bg-card shadow-[var(--shadow-card)]">
                <div className="px-4 pb-3 pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="flex min-w-0 items-center gap-2 text-sm font-bold">
                      <Building2 className="h-4 w-4 shrink-0 text-primary" />
                      <span className="truncate">Set up checklist</span>
                    </h2>
                    <span className="shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">
                      {kycDone}/{kyc.length}
                    </span>
                  </div>
                  <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${(kycDone / kyc.length) * 100}%` }}
                    />
                  </div>
                </div>
                <ul className="divide-y divide-border border-t border-border/70">
                  {kyc.map((k) => (
                    <li key={k.label}>
                      <Link
                        to={k.to}
                        className={`flex min-h-10 items-center gap-2.5 px-4 py-2 text-xs leading-4 transition-colors hover:bg-surface ${
                          k.done ? "text-muted-foreground" : "text-foreground"
                        }`}
                      >
                        <span
                          className={`grid h-4 w-4 shrink-0 place-items-center rounded-full ${
                            k.done
                              ? "bg-success text-success-foreground"
                              : "border border-border bg-card"
                          }`}
                          aria-hidden
                        >
                          {k.done ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
                        </span>
                        <span className="min-w-0 flex-1">{k.label}</span>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {learn.length > 0 && (
              <section className="rounded-[1.375rem] border border-border bg-card p-4 shadow-[var(--shadow-card)] sm:p-5">
                <div className="mb-4 flex items-center gap-2">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary-light text-primary">
                    <GraduationCap className="h-4 w-4" />
                  </span>
                  <h2 className="text-sm font-bold">Hire smarter</h2>
                </div>
                <ul className="space-y-1.5">
                  {learn.map((l) => (
                    <li key={l.id}>
                      <a
                        href={`/learn/${l.slug}`}
                        className="flex items-center gap-3 rounded-xl p-2.5 transition-colors hover:bg-surface"
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
                          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                            {l.kind} · {l.category || "Tips"}
                          </p>
                        </div>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        </div>

        <section className="min-w-0 overflow-hidden rounded-[1.375rem] border border-border bg-card shadow-[var(--shadow-card)]">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
            <h2 className="flex min-w-0 items-center gap-2.5 text-base font-bold">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary-light text-primary">
                <Users className="h-4 w-4" />
              </span>
              <span className="truncate">Recent applicants</span>
            </h2>
            <Link
              to="/employer/responses"
              className="inline-flex h-8 shrink-0 items-center rounded-lg px-2.5 text-xs font-semibold text-primary transition-colors hover:bg-primary-light"
            >
              Open inbox →
            </Link>
          </div>
          <div className="min-w-0">
            {recent.length === 0 ? (
              <div className="px-4 sm:px-6">
                <p className="my-5 rounded-xl border border-dashed border-border bg-surface px-4 py-9 text-center text-sm leading-relaxed text-muted-foreground break-words">
                  No applicants yet — post a job to start receiving applications.
                </p>
              </div>
            ) : (
              <div role="table" aria-label="Recent applicants">
                <div
                  role="row"
                  className="hidden grid-cols-[minmax(12rem,1.5fr)_minmax(10rem,1.25fr)_minmax(9rem,1fr)_minmax(7rem,.75fr)_minmax(7rem,.75fr)] gap-4 border-b border-border bg-surface/60 px-6 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground min-[1180px]:grid"
                >
                  <span role="columnheader">Candidate</span>
                  <span role="columnheader">Job role</span>
                  <span role="columnheader">Applied timeline</span>
                  <span role="columnheader" className="text-center">
                    Status
                  </span>
                  <span role="columnheader" className="text-right">
                    Action
                  </span>
                </div>
                <div className="divide-y divide-border">
                  {recent.map((a) => (
                    <div
                      key={a.id}
                      role="row"
                      className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 px-4 py-3 transition-colors hover:bg-surface/70 sm:px-6 min-[1180px]:grid-cols-[minmax(12rem,1.5fr)_minmax(10rem,1.25fr)_minmax(9rem,1fr)_minmax(7rem,.75fr)_minmax(7rem,.75fr)] min-[1180px]:items-center min-[1180px]:gap-4"
                    >
                      <div role="cell" className="flex min-w-0 items-center gap-3">
                        <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-primary-light text-xs font-bold text-primary ring-1 ring-primary/10">
                          {a.profiles?.avatar_url ? (
                            <img
                              src={a.profiles.avatar_url}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            (a.profiles?.full_name || "?").slice(0, 1).toUpperCase()
                          )}
                        </div>
                        <p className="min-w-0 truncate text-sm font-semibold text-foreground">
                          {a.profiles?.full_name || "Candidate"}
                        </p>
                      </div>
                      <div
                        role="cell"
                        className="col-start-1 row-start-2 min-w-0 pl-12 min-[1180px]:col-auto min-[1180px]:row-auto min-[1180px]:pl-0"
                      >
                        <p className="truncate text-xs font-medium text-foreground min-[1180px]:text-sm">
                          {a.jobs?.title || "—"}
                        </p>
                      </div>
                      <div
                        role="cell"
                        className="col-start-1 row-start-3 pl-12 text-[11px] text-muted-foreground min-[1180px]:col-auto min-[1180px]:row-auto min-[1180px]:pl-0 min-[1180px]:text-xs"
                      >
                        {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                      </div>
                      <div
                        role="cell"
                        className="col-start-2 row-start-1 flex justify-end self-center min-[1180px]:col-auto min-[1180px]:row-auto min-[1180px]:justify-center"
                      >
                        <span
                          className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${applicantStatusTone(a.status)}`}
                        >
                          {applicantStatusLabel(a.status)}
                        </span>
                      </div>
                      <div
                        role="cell"
                        className="col-start-2 row-span-2 row-start-2 flex items-center justify-end self-center min-[1180px]:col-auto min-[1180px]:row-auto min-[1180px]:row-span-1"
                      >
                        {a.jobs?.id ? (
                          <Link
                            to="/employer/jobs/$jobId/applicants"
                            params={{ jobId: a.jobs.id }}
                            className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-card px-2.5 text-[11px] font-semibold text-primary transition-colors hover:border-primary/40 hover:bg-primary-light"
                          >
                            View Profile
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {stats.activeJobs === 0 && (
          <div className="rounded-[1.375rem] border-2 border-dashed border-border bg-card p-8 text-center shadow-[var(--shadow-card)]">
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
      </div>
    </EmployerShell>
  );
}
