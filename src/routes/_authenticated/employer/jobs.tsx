import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Briefcase, CalendarClock, ChevronDown, ChevronRight, Copy, Eye, Filter, MoreVertical, Pause, Pencil, Play, Plus, RefreshCw, Rocket, Search, Trash2, Users,
} from "lucide-react";
import { toast } from "sonner";
import { EmployerShell } from "@/components/employer/EmployerShell";
import { BoostJobModal } from "@/components/employer/BoostJobModal";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyCompanies, getActiveCompanyId } from "@/lib/employer";
import { formatSalary, jobTypeLabel } from "@/lib/format";
import { getBoostOverview } from "@/lib/boost.functions";
import { getExpiryState, mapExpiryError, renewJob, setJobAutoRenew } from "@/lib/expiry.functions";
import { jobQualityLabel } from "@/lib/jobQuality";
import { formatDistanceToNow } from "date-fns";
import { Pagination } from "@/components/site/Pagination";
import { usePaginatedQuery } from "@/hooks/use-paginated-query";

const JOBS_PAGE_SIZE = 10;

export const Route = createFileRoute("/_authenticated/employer/jobs")({
  head: () => ({ meta: [{ title: "Manage Jobs · JobsKart" }] }),
  component: EmployerJobs,
});

type Job = {
  id: string;
  title: string;
  city: string | null;
  status: string;
  job_type: string;
  min_salary: number | null;
  max_salary: number | null;
  salary_period: string | null;
  applications_count: number | null;
  views_count: number | null;
  quality_score: number | null;
  created_at: string;
  expires_at: string | null;
  auto_renew: boolean;
  renewed_count: number;
};

const STATUSES = ["all", "active", "paused", "closed", "draft"] as const;

// Presentation-only "gamification" — derived entirely from existing
// quality_score data, no points economy or new tables (see
// job-quality-score-implementation.md, decision (d)).
function posterLevel(stats: { avg: number; total: number }): string {
  if (stats.avg >= 75 && stats.total >= 5) return "Elite Posting";
  if (stats.avg >= 55 && stats.total >= 2) return "Pro Posting";
  return "Starting Posting";
}

function EmployerJobs() {
  const { pathname } = useLocation();
  if (pathname !== "/employer/jobs") return <Outlet />;

  return <EmployerJobsList />;
}

const DEFAULT_BOOST_OVERVIEW = {
  balance: 0,
  settings: { costCredits: 1, windowHours: 24, enabled: true },
  activeBoostEndsAtByJobId: {} as Record<string, string>,
};

function EmployerJobsList() {
  const [cid, setCid] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({ all: 0, active: 0, paused: 0, closed: 0, draft: 0 });
  const [qualityStats, setQualityStats] = useState<{ avg: number; excellentCount: number; total: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  // Status filter popover anchors to the trigger's right edge on mobile (so it
  // never overflows the viewport) and to the left edge on sm:+ desktop,
  // matching the Tailwind `sm` breakpoint — Radix's `align` prop isn't
  // settable via className, so it has to be tracked in JS.
  const [statusAlign, setStatusAlign] = useState<"start" | "end">("start");
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setStatusAlign(mq.matches ? "end" : "start");
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return;
      let id = getActiveCompanyId();
      if (!id) {
        const ms = await fetchMyCompanies(user.user.id);
        id = ms[0]?.company_id ?? null;
      }
      setCid(id);
    })();
  }, []);

  const loadCounts = async (companyId: string) => {
    const { data, error } = await supabase.from("jobs").select("status, quality_score").eq("company_id", companyId);
    if (error) return toast.error(error.message);
    const rows = (data || []) as { status: string; quality_score: number | null }[];
    const c: Record<string, number> = { all: rows.length };
    for (const s of ["active", "paused", "closed", "draft"]) {
      c[s] = rows.filter((r) => r.status === s).length;
    }
    setCounts(c);

    const liveRows = rows.filter((r) => r.status === "active" || r.status === "paused");
    if (liveRows.length > 0) {
      const scores = liveRows.map((r) => r.quality_score ?? 0);
      setQualityStats({
        avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
        excellentCount: scores.filter((s) => s >= 80).length,
        total: scores.length,
      });
    } else {
      setQualityStats(null);
    }
  };
  useEffect(() => { if (cid) loadCounts(cid); /* eslint-disable-next-line */ }, [cid]);

  const runGetBoostOverview = useServerFn(getBoostOverview);
  const [boostOverview, setBoostOverview] = useState(DEFAULT_BOOST_OVERVIEW);
  const [boostTarget, setBoostTarget] = useState<Job | null>(null);
  const loadBoostOverview = async (companyId: string) => {
    try {
      const overview = await runGetBoostOverview({ data: { companyId } });
      setBoostOverview(overview);
    } catch {
      /* non-critical — boost button just falls back to defaults */
    }
  };
  useEffect(() => { if (cid) loadBoostOverview(cid); /* eslint-disable-next-line */ }, [cid]);

  const runGetExpiryState = useServerFn(getExpiryState);
  const runRenewJob = useServerFn(renewJob);
  const runSetAutoRenew = useServerFn(setJobAutoRenew);
  const [expiry, setExpiry] = useState<{
    jobs: Record<string, { expires_at: string | null; auto_renew: boolean; renewed_count: number }>;
    entitlement: { enabled: boolean; maxTimes: number };
  }>({ jobs: {}, entitlement: { enabled: false, maxTimes: 3 } });
  const [renewTarget, setRenewTarget] = useState<Job | null>(null);
  const [renewBusy, setRenewBusy] = useState(false);

  const loadExpiryState = async (companyId: string) => {
    try {
      const s = await runGetExpiryState({ data: { companyId } });
      const byId: Record<string, { expires_at: string | null; auto_renew: boolean; renewed_count: number }> = {};
      for (const j of s.jobs) byId[j.id] = { expires_at: j.expires_at, auto_renew: j.auto_renew, renewed_count: j.renewed_count };
      setExpiry({ jobs: byId, entitlement: s.entitlement });
    } catch {
      /* non-critical — chips/toggle just stay hidden */
    }
  };
  useEffect(() => { if (cid) loadExpiryState(cid); /* eslint-disable-next-line */ }, [cid]);

  // Existing project-wide pagination: page state, limit/offset math, and
  // total-count tracking are owned by usePaginatedQuery; only how a page is
  // fetched (this exact filtered/sorted Supabase query) is provided here.
  // Same hook + <Pagination> pairing already used by the Candidate Database
  // and Responses inbox pages.
  const {
    rows: jobs,
    total: jobsTotal,
    totalPages,
    page,
    setPage,
    isLoading: loading,
    refetch: refetchJobs,
  } = usePaginatedQuery<Job>({
    queryKey: ["employer-jobs", cid, statusFilter, search],
    pageSize: JOBS_PAGE_SIZE,
    enabled: !!cid,
    fetchPage: async ({ from, to }) => {
      if (!cid) return { rows: [], total: 0 };
      let q = supabase
        .from("jobs")
        .select(
          "id, title, city, status, job_type, min_salary, max_salary, salary_period, applications_count, views_count, quality_score, created_at, expires_at, auto_renew, renewed_count",
          { count: "exact" },
        )
        .eq("company_id", cid)
        .order("created_at", { ascending: false });
      if (statusFilter !== "all") q = q.eq("status", statusFilter as never);
      if (search.trim()) q = q.ilike("title", `%${search.trim()}%`);
      q = q.range(from, to);
      const { data, count, error } = await q;
      if (error) throw error;
      return { rows: (data || []) as Job[], total: count ?? 0 };
    },
  });

  // A full reload after a mutation (status change, duplicate, delete) needs
  // both the current page's rows and the status-badge counts refreshed.
  const reload = () => {
    refetchJobs();
    if (cid) loadCounts(cid);
  };

  // A stale selection could otherwise silently act on jobs no longer visible
  // once the filters or page change what's on screen.
  useEffect(() => { setSelected(new Set()); }, [statusFilter, search, page]);

  const confirmRenew = async () => {
    if (!renewTarget || !cid) return;
    setRenewBusy(true);
    try {
      const r = await runRenewJob({ data: { jobId: renewTarget.id } });
      toast.success(`Renewed until ${new Date(r.expires_at).toLocaleDateString("en-IN", { dateStyle: "medium" })}.`);
      setRenewTarget(null);
      reload();
      loadExpiryState(cid);
    } catch (e) {
      toast.error(mapExpiryError(e instanceof Error ? e.message : "Could not renew this job."));
    } finally {
      setRenewBusy(false);
    }
  };

  const toggleAutoRenew = async (job: Job, enabled: boolean) => {
    if (!cid) return;
    try {
      await runSetAutoRenew({ data: { jobId: job.id, enabled } });
      toast.success(enabled ? "Auto-renew enabled." : "Auto-renew disabled.");
      reload();
      loadExpiryState(cid);
    } catch (e) {
      toast.error(mapExpiryError(e instanceof Error ? e.message : "Could not update auto-renew."));
    }
  };

  const toggleSelect = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const setStatus = async (id: string, status: "active" | "paused" | "closed") => {
    const { error } = await supabase.from("jobs").update({ status } as never).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(`Job ${status}.`);
    reload();
  };

  const duplicate = async (id: string) => {
    const { data: full, error: fErr } = await supabase.from("jobs").select("*").eq("id", id).single();
    if (fErr || !full) return toast.error(fErr?.message || "Could not load job");
    const f = full as Record<string, unknown>;
    delete f.id; delete f.created_at; delete f.updated_at; delete f.slug;
    delete f.applications_count; delete f.views_count; delete f.quality_score;
    f.title = `${f.title} (copy)`;
    f.status = "draft";
    const { error } = await supabase.from("jobs").insert(f as never);
    if (error) return toast.error(error.message);
    toast.success("Job duplicated as draft.");
    reload();
  };

  const bulkDelete = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    setBulkBusy(true);
    const { error } = await supabase.from("jobs").delete().in("id", ids);
    setBulkBusy(false);
    setConfirmDeleteOpen(false);
    if (error) return toast.error(error.message);
    toast.success(`Deleted ${ids.length} job${ids.length === 1 ? "" : "s"}.`);
    setSelected(new Set());
    reload();
  };

  // Mixed selections only pause the jobs that are currently active — already
  // paused/closed/draft jobs in the selection are left untouched rather than
  // a "Pause" click force-changing statuses it wasn't asked to touch.
  const bulkPause = async () => {
    const ids = jobs.filter((j) => selected.has(j.id) && j.status === "active").map((j) => j.id);
    if (!ids.length) { toast.info("No active jobs in the selection to pause."); return; }
    setBulkBusy(true);
    const { error } = await supabase.from("jobs").update({ status: "paused" } as never).in("id", ids);
    setBulkBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Paused ${ids.length} job${ids.length === 1 ? "" : "s"}.`);
    setSelected(new Set());
    reload();
  };

  const statusLabel = statusFilter === "all"
    ? "All status"
    : `${statusFilter[0].toUpperCase()}${statusFilter.slice(1)} (${counts[statusFilter] ?? 0})`;

  return (
    <EmployerShell
      title="Jobs"
      subtitle="Post, pause, or close your job listings."
      actions={
        selected.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground">{selected.size} selected</span>
            <button
              type="button"
              onClick={bulkPause}
              disabled={bulkBusy}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-semibold hover:bg-surface disabled:opacity-50"
            >
              <Pause className="h-4 w-4" /> Pause
            </button>
            <button
              type="button"
              onClick={() => setConfirmDeleteOpen(true)}
              disabled={bulkBusy}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-destructive/40 bg-destructive-light px-3 text-sm font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          </div>
        ) : (
          <Link
            to="/employer/jobs/new"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary-dark sm:hidden"
          >
            <Plus className="h-4 w-4" /> Post a job
          </Link>
        )
      }
    >
      {qualityStats && (
        <div className="mb-5 flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card px-4 py-3 shadow-[var(--shadow-card)]">
          <div>
            <p className="text-[11px] font-medium uppercase text-muted-foreground">Posting level</p>
            <p className="text-sm font-bold text-primary">{posterLevel(qualityStats)}</p>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase text-muted-foreground">Avg. quality</p>
            <p className="text-sm font-bold">{qualityStats.avg}/100</p>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase text-muted-foreground">Excellent posts</p>
            <p className="text-sm font-bold">{qualityStats.excellentCount} of {qualityStats.total}</p>
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-nowrap items-center gap-2 rounded-xl border border-border bg-card p-2.5 shadow-[var(--shadow-card)] sm:flex-wrap">
        <div className="relative min-w-0 flex-1 sm:w-full sm:max-w-xs sm:flex-initial">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title…"
            className="form-input h-9 w-full pl-9 text-sm"
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-semibold text-foreground hover:bg-surface sm:gap-2 sm:px-3"
            >
              <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="sm:hidden">{statusFilter === "all" ? "All status" : statusLabel}</span>
              <span className="hidden sm:inline">{statusLabel}</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align={statusAlign}
            collisionPadding={12}
            className="w-52 max-sm:w-[min(185px,calc(100vw-24px))] max-sm:max-w-[calc(100vw-24px)]"
          >
            <DropdownMenuRadioGroup value={statusFilter} onValueChange={setStatusFilter}>
              {STATUSES.map((s) => (
                <DropdownMenuRadioItem key={s} value={s} className="h-9 rounded-md px-2.5 capitalize">
                  <span className="whitespace-nowrap">{s === "all" ? "All Status" : s}</span>
                  <span className="ml-auto pl-2 text-xs tabular-nums text-muted-foreground">({counts[s] ?? 0})</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Desktop only: Post a job now lives in this controls row, aligned with Search and All status, instead of beside the "Jobs" heading. */}
        <Link
          to="/employer/jobs/new"
          className="ml-auto hidden h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary-dark sm:inline-flex"
        >
          <Plus className="h-4 w-4" /> Post a job
        </Link>
      </div>

      {loading ? (
        <div className="space-y-2.5">{[1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-card" />)}</div>
      ) : jobs.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-border bg-card p-10 text-center">
          <Briefcase className="mx-auto h-10 w-10 text-muted-foreground" />
          <h3 className="mt-3 text-lg font-bold">No jobs yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">Post your first job in 3 minutes.</p>
          <Link to="/employer/jobs/new" className="mt-4 inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground">
            <Plus className="h-4 w-4" /> Post a job
          </Link>
        </div>
      ) : (
        <div className="space-y-2.5 pb-4 lg:pb-0">
          {jobs.map((j) => (
            <div key={j.id} className="rounded-xl border border-border bg-card p-3 shadow-[var(--shadow-card)] transition-colors hover:border-primary/30 sm:p-4">
              <div className="flex flex-wrap items-start gap-x-3 gap-y-2 sm:flex-nowrap sm:items-center">
                <input
                  type="checkbox"
                  checked={selected.has(j.id)}
                  onChange={() => toggleSelect(j.id)}
                  className="mt-1 h-4 w-4 shrink-0 accent-primary sm:mt-0"
                  aria-label={`Select ${j.title}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to="/jobs/$jobId"
                      params={{ jobId: j.id }}
                      className="truncate text-base font-semibold hover:text-primary hover:underline"
                    >
                      {j.title}
                    </Link>
                    <Badge
                      variant={j.status === "active" ? "success" : j.status === "paused" ? "warning" : "muted"}
                      className="shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase"
                    >
                      {j.status}
                    </Badge>
                    {boostOverview.activeBoostEndsAtByJobId[j.id] && new Date(boostOverview.activeBoostEndsAtByJobId[j.id]) > new Date() && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-light px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">
                        <Rocket className="h-3 w-3" /> Boosted · {formatDistanceToNow(new Date(boostOverview.activeBoostEndsAtByJobId[j.id]))} left
                      </span>
                    )}
                    {j.status === "active" && j.expires_at && (() => {
                      const days = Math.ceil((new Date(j.expires_at).getTime() - Date.now()) / 86_400_000);
                      const cls = days <= 2 ? "bg-destructive-light text-destructive" : days <= 7 ? "bg-warning-light text-warning" : "bg-surface text-muted-foreground";
                      return (
                        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${cls}`}>
                          <CalendarClock className="h-3 w-3" /> {days <= 0 ? "Expiring" : `Expires in ${days}d`}
                        </span>
                      );
                    })()}
                    {j.status === "active" && expiry.jobs[j.id]?.auto_renew && (
                      <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                        Auto-renew on
                      </span>
                    )}
                    {j.status !== "draft" && (() => {
                      const { label, color } = jobQualityLabel(j.quality_score ?? 0);
                      return (
                        <span className={`shrink-0 rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase ${color}`}>
                          {label} · {j.quality_score ?? 0}
                        </span>
                      );
                    })()}
                    {j.status !== "draft" && (j.quality_score ?? 0) < 60 && (
                      <Link
                        to="/employer/jobs/$jobId/edit"
                        params={{ jobId: j.id }}
                        className="shrink-0 text-[10px] font-semibold text-primary hover:underline"
                      >
                        Improve
                      </Link>
                    )}

                    {/* Desktop: Copy/Edit/Boost stay as always-visible icon buttons. */}
                    {j.status === "active" && (
                      <button
                        onClick={() => setBoostTarget(j)}
                        title="Boost this job"
                        className="hidden h-7 w-7 shrink-0 place-items-center rounded-lg border border-border bg-card text-foreground hover:bg-surface sm:grid"
                      >
                        <Rocket className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button onClick={() => duplicate(j.id)} title="Duplicate" className="hidden h-7 w-7 shrink-0 place-items-center rounded-lg border border-border bg-card text-foreground hover:bg-surface sm:grid">
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <Link
                      to="/employer/jobs/$jobId/edit"
                      params={{ jobId: j.id }}
                      title="Edit"
                      className="hidden h-7 w-7 shrink-0 place-items-center rounded-lg border border-border bg-card text-foreground hover:bg-surface sm:grid"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Link>

                    {j.status === "paused" && (
                      <button onClick={() => setStatus(j.id, "active")} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs font-semibold hover:bg-surface">
                        <Play className="h-3.5 w-3.5" /> Resume
                      </button>
                    )}
                    {j.status === "expired" && (
                      <button onClick={() => setRenewTarget(j)} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs font-semibold hover:bg-surface">
                        <RefreshCw className="h-3.5 w-3.5" /> Renew &amp; relist
                      </button>
                    )}

                    {/* Mobile: Copy/Edit collapse into a single ⋮ menu, pinned to the far right of this row. */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          title="More actions"
                          aria-label="More actions"
                          className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-surface sm:hidden"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        {j.status === "active" && (
                          <DropdownMenuItem onClick={() => setBoostTarget(j)}>
                            <Rocket className="mr-2 h-3.5 w-3.5" /> Boost
                          </DropdownMenuItem>
                        )}
                        {j.status === "active" && (
                          <DropdownMenuItem onClick={() => setRenewTarget(j)}>
                            <RefreshCw className="mr-2 h-3.5 w-3.5" /> Renew
                          </DropdownMenuItem>
                        )}
                        {j.status === "active" && (
                          <DropdownMenuItem
                            onClick={() => toggleAutoRenew(j, !expiry.jobs[j.id]?.auto_renew)}
                            disabled={!expiry.jobs[j.id]?.auto_renew && !expiry.entitlement.enabled}
                            title={!expiry.entitlement.enabled ? "Auto-renew is a paid-plan feature" : undefined}
                          >
                            <CalendarClock className="mr-2 h-3.5 w-3.5" /> Auto-renew: {expiry.jobs[j.id]?.auto_renew ? "On" : "Off"}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => duplicate(j.id)}>
                          <Copy className="mr-2 h-3.5 w-3.5" /> Copy
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link to="/employer/jobs/$jobId/edit" params={{ jobId: j.id }}>
                            <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                          </Link>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {jobTypeLabel(j.job_type)} · {j.city || "Multiple cities"} · {formatSalary(j.min_salary, j.max_salary, j.salary_period || "monthly")}
                  </p>
                  {j.status === "draft" && (
                    <div className="mt-2">
                      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                        <span>{j.quality_score ?? 0}% complete — finish now</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-border">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${j.quality_score ?? 0}%` }} />
                      </div>
                    </div>
                  )}
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground sm:text-xs">
                    <Link
                      to="/employer/jobs/$jobId/applicants"
                      params={{ jobId: j.id }}
                      className="inline-flex items-center gap-1 font-semibold text-foreground transition-colors hover:text-primary active:text-primary"
                    >
                      <Users className="h-3.5 w-3.5" /> {j.applications_count || 0} applicants
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Link>
                    <span className="inline-flex items-center gap-1">
                      <Eye className="h-3.5 w-3.5" /> {j.views_count || 0} views
                    </span>
                    <span>Posted {formatDistanceToNow(new Date(j.created_at), { addSuffix: true })}</span>
                  </p>
                </div>
                <div className="ml-7 flex w-full shrink-0 items-center justify-end sm:ml-0 sm:w-auto">
                  <Link
                    to="/employer/jobs/$jobId/applicants"
                    params={{ jobId: j.id }}
                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-[11px] font-semibold text-primary transition-colors hover:border-primary/40 hover:bg-primary-light"
                  >
                    <Users className="h-3.5 w-3.5" /> Review candidates
                  </Link>
                </div>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <p className="text-xs text-muted-foreground tabular-nums">
              Showing {jobs.length} of {jobsTotal} listings
            </p>
          </div>
          {totalPages > 1 && (
            <Pagination page={page} totalPages={totalPages} onChange={setPage} className="mt-2" />
          )}
        </div>
      )}

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.size} job{selected.size === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {selected.size === 1 ? "this job posting" : `these ${selected.size} job postings`} and all of their applications. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={bulkDelete}
              disabled={bulkBusy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {boostTarget && (
        <BoostJobModal
          open={!!boostTarget}
          onOpenChange={(v) => { if (!v) setBoostTarget(null); }}
          job={{ id: boostTarget.id, title: boostTarget.title, createdAt: boostTarget.created_at }}
          balance={boostOverview.balance}
          settings={boostOverview.settings}
          onBoosted={() => {
            setBoostTarget(null);
            if (cid) loadBoostOverview(cid);
          }}
        />
      )}

      <AlertDialog open={!!renewTarget} onOpenChange={(v) => { if (!v && !renewBusy) setRenewTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Renew "{renewTarget?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {renewTarget?.status === "expired"
                ? "This job expired and is hidden from candidates. Renewing relists it immediately for a fresh validity period."
                : "Renewing extends this job's validity from its current expiry date — you won't lose any remaining days."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={renewBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={renewBusy} onClick={(e) => { e.preventDefault(); confirmRenew(); }}>
              {renewBusy ? "Renewing…" : "Renew job"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </EmployerShell>
  );
}
