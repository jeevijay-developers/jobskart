import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Briefcase, ChevronDown, ChevronRight, Copy, Eye, Filter, MoreVertical, Pause, Pencil, Play, Plus, Search, Trash2, Users,
} from "lucide-react";
import { toast } from "sonner";
import { EmployerShell, CreditChip } from "@/components/employer/EmployerShell";
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
import { formatDistanceToNow } from "date-fns";
import { Pagination } from "@/components/site/Pagination";
import { usePaginatedQuery } from "@/hooks/use-paginated-query";

const JOBS_PAGE_SIZE = 20;

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
  created_at: string;
};

const STATUSES = ["all", "active", "paused", "closed", "draft"] as const;

function EmployerJobs() {
  const { pathname } = useLocation();
  if (pathname !== "/employer/jobs") return <Outlet />;

  return <EmployerJobsList />;
}

function EmployerJobsList() {
  const [cid, setCid] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({ all: 0, active: 0, paused: 0, closed: 0, draft: 0 });
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
    const { data, error } = await supabase.from("jobs").select("status").eq("company_id", companyId);
    if (error) return toast.error(error.message);
    const rows = (data || []) as { status: string }[];
    const c: Record<string, number> = { all: rows.length };
    for (const s of ["active", "paused", "closed", "draft"]) {
      c[s] = rows.filter((r) => r.status === s).length;
    }
    setCounts(c);
  };
  useEffect(() => { if (cid) loadCounts(cid); /* eslint-disable-next-line */ }, [cid]);

  const {
    rows: jobs,
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
          "id, title, city, status, job_type, min_salary, max_salary, salary_period, applications_count, views_count, created_at",
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
      hideBell
      hideCreditChip
      headerLeft={
        <>
          {/* Mobile: credits chip sits beside the "Jobs" title; the Post button moves to the far right of the row (see the sm:hidden block right after the header). Desktop: the Post button now lives in the search/filter controls row below, not here. */}
          <div className="sm:hidden">
            <CreditChip />
          </div>
          <div className="hidden sm:block">
            <CreditChip />
          </div>
        </>
      }
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
      <div className="mb-5 flex flex-nowrap items-center gap-2 sm:flex-wrap sm:gap-3">
        <div className="relative min-w-0 flex-1 sm:w-full sm:max-w-xs sm:flex-initial">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title…"
            className="form-input h-10 w-full pl-9"
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-sm font-semibold text-foreground hover:bg-surface sm:gap-2 sm:px-3"
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
          className="ml-auto hidden h-10 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary-dark sm:inline-flex"
        >
          <Plus className="h-4 w-4" /> Post a job
        </Link>
      </div>

      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-card" />)}</div>
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
        <div className="space-y-3 pb-4 lg:pb-0">
          {jobs.map((j) => (
            <div key={j.id} className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(j.id)}
                  onChange={() => toggleSelect(j.id)}
                  className="mt-1.5 h-4 w-4 shrink-0 accent-primary"
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
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                      j.status === "active" ? "bg-success-light text-success" :
                      j.status === "paused" ? "bg-warning-light text-warning" :
                      "bg-surface text-muted-foreground"
                    }`}>{j.status}</span>

                    {/* Desktop: Copy/Edit stay as always-visible icon buttons. */}
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
                  <p className="mt-1 text-sm text-muted-foreground">
                    {jobTypeLabel(j.job_type)} · {j.city || "Multiple cities"} · {formatSalary(j.min_salary, j.max_salary, j.salary_period || "monthly")}
                  </p>
                  <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
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
              </div>
            </div>
          ))}
          {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onChange={setPage} />}
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
    </EmployerShell>
  );
}
