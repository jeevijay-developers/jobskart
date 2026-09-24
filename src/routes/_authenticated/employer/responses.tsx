import { ThemedSelect } from "@/components/ui/themed-form-controls";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import * as XLSX from "xlsx";
import {
  CheckCircle2,
  ChevronDown,
  Filter,
  Inbox,
  RefreshCw,
  Sparkle,
  XCircle,
  Calendar,
  Download,
  AlertTriangle,
  MoreVertical,
  Search,
} from "lucide-react";
import { EmployerShell } from "@/components/employer/EmployerShell";
import {
  ApplicantReviewPanel,
  type ReviewApplicant,
} from "@/components/employer/ApplicantReviewPanel";
import { ScheduleInterviewModal } from "@/components/employer/ScheduleInterviewModal";
import {
  APPLICANT_STATUSES,
  applicantStatusLabel,
  applicantStatusTone,
} from "@/lib/applicantStatus";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyCompanies, getActiveCompanyId } from "@/lib/employer";
import { recommendShortlist } from "@/lib/ai-shortlist.functions";
import { buildDownloadDataset } from "@/lib/downloads.functions";
import { Pagination } from "@/components/site/Pagination";
import { usePaginatedQuery } from "@/hooks/use-paginated-query";

export const Route = createFileRoute("/_authenticated/employer/responses")({
  head: () => ({ meta: [{ title: "Responses · JobsKart Employer" }] }),
  component: ResponsesPage,
});

// "interview" is scheduled through ScheduleInterviewModal, not setStatus(), so
// it never reaches this set from this page — kept to shortlisted/rejected.
const NOTIFY_STATUSES = new Set(["shortlisted", "rejected"]);
const RESPONSES_PAGE_SIZE = 20;

type Row = {
  id: string;
  status: string;
  created_at: string;
  candidate_id: string;
  cover_note: string | null;
  expected_salary: number | null;
  available_from: string | null;
  jobs: { id: string; title: string } | null;
  profiles: {
    full_name: string | null;
    email: string | null;
    city: string | null;
    avatar_url: string | null;
    mobile: string | null;
  } | null;
};

type AiRow = {
  application_id: string;
  candidate_id: string;
  score: number;
  reasons: string[];
  summary: string | null;
  full_name: string | null;
  city: string | null;
  avatar_url: string | null;
  status: string;
  created_at: string;
};

type PendingStatusChange = { ids: string[]; names: string[]; status: string; label: string };

function ResponsesPage() {
  const [cid, setCid] = useState<string | null>(null);
  const [jobs, setJobs] = useState<{ id: string; title: string }[]>([]);
  const [jobFilter, setJobFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [nameQuery, setNameQuery] = useState("");
  const [tab, setTab] = useState<"inbox" | "ai">("inbox");
  const [aiRows, setAiRows] = useState<AiRow[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [shortlistN, setShortlistN] = useState(10);
  const [downloading, setDownloading] = useState(false);
  const [expiringCount, setExpiringCount] = useState(0);

  const [filterOpen, setFilterOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [jobDraft, setJobDraft] = useState("");

  const [pending, setPending] = useState<PendingStatusChange | null>(null);
  const [pendingBusy, setPendingBusy] = useState(false);

  const [cpMap, setCpMap] = useState<Record<string, ReviewApplicant["candidate_profiles"]>>({});
  const [reviewing, setReviewing] = useState<Row | null>(null);
  const [scheduling, setScheduling] = useState<{
    applicationId: string;
    candidateName: string | null;
  } | null>(null);

  const recommend = useServerFn(recommendShortlist);
  const buildDownload = useServerFn(buildDownloadDataset);

  const doDownload = async () => {
    if (!cid) return;
    setDownloading(true);
    try {
      const { rows: dl, todayCount } = await buildDownload({
        data: { companyId: cid, kind: "responses", jobId: jobFilter || undefined },
      });
      const ws = XLSX.utils.json_to_sheet(dl);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Responses");
      XLSX.writeFile(wb, `jobskart-responses-${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success(`Downloaded ${dl.length} rows · ${todayCount}/300 today`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  };

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
      if (!id) return;
      setCid(id);
      const { data: js } = await supabase
        .from("jobs")
        .select("id, title")
        .eq("company_id", id)
        .order("created_at", { ascending: false });
      setJobs(js || []);
    })();
  }, []);

  const {
    rows: filtered,
    total: inboxTotal,
    totalPages: inboxTotalPages,
    page: inboxPage,
    setPage: setInboxPage,
    isLoading: loading,
    refetch: refetchInbox,
  } = usePaginatedQuery<Row>({
    queryKey: ["employer-responses", "inbox", cid, jobFilter, statusFilter, nameQuery],
    pageSize: RESPONSES_PAGE_SIZE,
    enabled: !!cid,
    fetchPage: async ({ from, to }) => {
      if (!cid) return { rows: [], total: 0 };
      let qy = supabase
        .from("applications")
        .select(
          "id, status, created_at, candidate_id, cover_note, expected_salary, available_from, jobs!inner (id, title, company_id), profiles!candidate_id!inner (full_name, email, city, avatar_url, mobile)",
          { count: "exact" },
        )
        .eq("jobs.company_id", cid)
        .order("created_at", { ascending: false });
      if (jobFilter) qy = qy.eq("job_id", jobFilter);
      if (statusFilter) qy = qy.eq("status", statusFilter as never);
      if (nameQuery.trim()) qy = qy.ilike("profiles.full_name", `%${nameQuery.trim()}%`);
      qy = qy.range(from, to);
      const { data, count, error } = await qy;
      if (error) throw error;
      return { rows: (data || []) as unknown as Row[], total: count ?? 0 };
    },
  });

  const inboxStatusCounts = useMemo(
    () =>
      Object.fromEntries(
        APPLICANT_STATUSES.map((status) => [
          status.id,
          filtered.filter((row) => row.status === status.id).length,
        ]),
      ),
    [filtered],
  );

  // Candidate-profile snippets (headline/skills) for the review panel, scoped
  // to whichever page of the inbox is currently on screen.
  useEffect(() => {
    const candidateIds = Array.from(new Set(filtered.map((r) => r.candidate_id)));
    if (!candidateIds.length) return;
    (async () => {
      const { data: cps } = await supabase
        .from("candidate_profiles")
        .select("user_id, profile_slug, headline, last_role, skills")
        .in("user_id", candidateIds);
      setCpMap(Object.fromEntries((cps || []).map((c) => [c.user_id, c])));
    })();
  }, [filtered]);

  const filteredAiRows = useMemo(() => {
    if (!nameQuery.trim()) return aiRows;
    const needle = nameQuery.toLowerCase();
    return aiRows.filter((r) => (r.full_name || "").toLowerCase().includes(needle));
  }, [aiRows, nameQuery]);

  const eligibleAiRows = useMemo(
    () => filteredAiRows.filter((r) => r.status === "applied"),
    [filteredAiRows],
  );

  const setStatus = async (ids: string[], status: string) => {
    setReviewing((r) => (r && ids.includes(r.id) ? { ...r, status } : r));
    const { error } = await supabase
      .from("applications")
      .update({ status } as never)
      .in("id", ids);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Marked ${ids.length} as ${status}`);
    refetchInbox();
    if (NOTIFY_STATUSES.has(status)) {
      for (const id of ids) {
        supabase.functions
          .invoke("application-status-notify", { body: { applicationId: id, status } })
          .catch(() => { });
      }
    }
  };

  const askConfirm = (ids: string[], names: Array<string | null | undefined>, status: string) => {
    setPending({
      ids,
      names: names.map((n) => n || "this candidate"),
      status,
      label: applicantStatusLabel(status),
    });
  };

  const confirmStatusChange = async () => {
    if (!pending) return;
    setPendingBusy(true);
    await setStatus(pending.ids, pending.status);
    setPendingBusy(false);
    setPending(null);
  };

  const shortlistTopN = () => {
    const top = eligibleAiRows.slice(0, shortlistN);
    if (!top.length) return;
    askConfirm(
      top.map((r) => r.application_id),
      top.map((r) => r.full_name),
      "shortlisted",
    );
  };

  const openFilters = () => {
    setNameDraft(nameQuery);
    setJobDraft(jobFilter);
    setFilterOpen(true);
  };
  const applyFilters = () => {
    setNameQuery(nameDraft);
    setJobFilter(jobDraft);
    setFilterOpen(false);
  };
  const clearFilters = () => {
    setNameDraft("");
    setJobDraft("");
    setNameQuery("");
    setJobFilter("");
    setFilterOpen(false);
  };

  const loadAi = async (refresh = false) => {
    if (!jobFilter) {
      toast.error("Pick a job to get AI recommendations.");
      return;
    }
    setAiLoading(true);
    try {
      const data = await recommend({ data: { jobId: jobFilter, refresh } });
      setAiRows(data as AiRow[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI failed");
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    if (tab === "ai" && jobFilter) loadAi(false);
    // eslint-disable-next-line
  }, [tab, jobFilter]);

  return (
    <EmployerShell
      title="Responses"
      subtitle="One inbox for every candidate across your jobs."
      actions={
        <div className="flex flex-wrap gap-2">
          <button
            onClick={doDownload}
            disabled={downloading}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-semibold hover:bg-surface disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="sm:hidden">Excel</span>
            <span className="hidden sm:inline">Excel (max 300/day)</span>
          </button>
          <button
            onClick={() => refetchInbox()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-semibold hover:bg-surface"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      }
    >
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning-light px-3 py-2 text-[11px] leading-4 text-warning sm:text-xs">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0">
          Responses for expired jobs stay accessible for 7 days after expiry, then get locked.
          Download important candidates in time.
          {expiringCount > 0 ? ` (${expiringCount} job(s) expiring soon)` : ""}
        </span>
      </div>

      <div className="mb-3 inline-flex max-w-full gap-1 rounded-lg border border-border bg-card p-1">
        <button
          onClick={() => setTab("inbox")}
          className={`flex items-center justify-center gap-1.5 rounded-md px-4 py-1.5 text-xs font-semibold transition-colors ${tab === "inbox"
            ? "bg-primary text-primary-foreground"
            : "text-foreground/70 hover:bg-surface"
            }`}
        >
          <Inbox className="h-3.5 w-3.5" /> Inbox{" "}
          <span className="rounded-full bg-black/10 px-1.5 text-[10px] tabular-nums">
            {inboxTotal}
          </span>
        </button>
        <button
          onClick={() => setTab("ai")}
          className={`flex items-center justify-center gap-1.5 rounded-md px-4 py-1.5 text-xs font-semibold transition-colors ${tab === "ai"
            ? "bg-primary text-primary-foreground"
            : "text-foreground/70 hover:bg-surface"
            }`}
        >
          <Sparkle className="h-3.5 w-3.5" /> AI shortlist
        </button>
      </div>

      <section className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2.5 shadow-[var(--shadow-card)]">
        <div className="relative min-w-[12rem] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            placeholder="Search candidates..."
            className="form-input h-9 w-full pl-9 text-sm"
            aria-label="Search candidates"
          />
        </div>
        <Sheet open={filterOpen} onOpenChange={(o) => (o ? openFilters() : setFilterOpen(false))}>
          <SheetTrigger asChild>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-surface"
            >
              <Filter className="h-4 w-4 text-muted-foreground" /> Filter
              {(nameQuery || jobFilter) && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
            </button>
          </SheetTrigger>
          <SheetContent side="right" className="flex w-full flex-col sm:max-w-sm">
            <SheetHeader>
              <SheetTitle>Filter responses</SheetTitle>
              <SheetDescription>
                Search by candidate name and narrow down to a specific job.
              </SheetDescription>
            </SheetHeader>
            <div className="mt-6 flex-1 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                  Candidate name
                </label>
                <input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  placeholder="Search by name…"
                  className="form-input h-10 w-full"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                  Job
                </label>
                <ThemedSelect
                  value={jobDraft}
                  onChange={(e) => setJobDraft(e.target.value)}
                  className="form-input h-10 w-full"
                >
                  <option value="">All jobs</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.title}
                    </option>
                  ))}
                </ThemedSelect>
              </div>
            </div>
            <SheetFooter className="mt-6">
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-semibold hover:bg-surface"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={applyFilters}
                className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-dark"
              >
                Apply filters
              </button>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        {tab === "inbox" ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-surface"
              >
                {statusFilter ? applicantStatusLabel(statusFilter) : "All status"}
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup
                value={statusFilter || "all"}
                onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}
              >
                <DropdownMenuRadioItem value="all">All status</DropdownMenuRadioItem>
                {APPLICANT_STATUSES.map((s) => (
                  <DropdownMenuRadioItem key={s.id} value={s.id}>
                    {s.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <>
            <button
              onClick={() => loadAi(true)}
              disabled={!jobFilter || aiLoading}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-primary bg-primary-light px-3 text-xs font-semibold text-primary disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${aiLoading ? "animate-spin" : ""}`} /> Re-rank
            </button>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={50}
                value={shortlistN}
                onChange={(e) =>
                  setShortlistN(Math.max(1, Math.min(50, Number(e.target.value) || 1)))
                }
                className="form-input h-9 w-16 text-center text-sm"
                aria-label="Number of candidates to shortlist"
              />
              <button
                onClick={shortlistTopN}
                disabled={!jobFilter || aiLoading || eligibleAiRows.length === 0}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-success px-3 text-xs font-semibold text-success-foreground disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Shortlist top {shortlistN}
              </button>
            </div>
          </>
        )}
      </section>

      {tab === "inbox" && !statusFilter && inboxTotalPages <= 1 && filtered.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="rounded-full border border-primary/20 bg-primary-light px-2.5 py-1 font-semibold text-primary">
            All <span className="ml-1 tabular-nums">{inboxTotal}</span>
          </span>
          {APPLICANT_STATUSES.slice(0, 4).map((status) => (
            <span
              key={status.id}
              className="rounded-full border border-border bg-card px-2.5 py-1 font-medium text-muted-foreground"
            >
              {status.label}{" "}
              <span className="ml-1 font-semibold text-foreground tabular-nums">
                {inboxStatusCounts[status.id] ?? 0}
              </span>
            </span>
          ))}
        </div>
      )}

      {tab === "inbox" ? (
        <>
          {loading ? (
            <div className="h-64 animate-pulse rounded-2xl bg-card" />
          ) : filtered.length === 0 ? (
            <EmptyResponses />
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-card)]">
              {filtered.map((r) => {
                return (
                  <li
                    key={r.id}
                    onClick={() => setReviewing(r)}
                    className="flex cursor-pointer flex-wrap items-center gap-2.5 px-3 py-2.5 transition-colors hover:bg-surface/70 sm:flex-nowrap sm:px-4"
                  >
                    <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-primary-light text-xs font-bold text-primary ring-1 ring-primary/10">
                      {r.profiles?.avatar_url ? (
                        <img
                          src={r.profiles.avatar_url}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        (r.profiles?.full_name || "?").slice(0, 1).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="truncate text-sm font-semibold">
                          {r.profiles?.full_name || "Candidate"}
                        </p>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${applicantStatusTone(r.status)}`}
                        >
                          {applicantStatusLabel(r.status)}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground sm:text-xs">
                        {r.jobs?.title}
                        {r.profiles?.city ? ` · ${r.profiles.city}` : ""}
                        {` · ${formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}`}
                      </p>
                    </div>
                    <div className="ml-11 flex w-full shrink-0 items-center justify-end gap-1.5 sm:ml-0 sm:w-auto">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          askConfirm([r.id], [r.profiles?.full_name], "shortlisted");
                        }}
                        className="hidden h-8 items-center gap-1 rounded-lg border border-success/30 bg-success-light px-2.5 text-[11px] font-semibold text-success hover:border-success/50 min-[1180px]:inline-flex"
                      >
                        <CheckCircle2 className="h-3 w-3" /> Shortlist
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setScheduling({
                            applicationId: r.id,
                            candidateName: r.profiles?.full_name ?? null,
                          });
                        }}
                        className="hidden h-8 items-center gap-1 rounded-lg border border-warning/40 bg-warning-light px-2.5 text-[11px] font-semibold text-warning hover:border-warning/60 min-[1180px]:inline-flex"
                      >
                        <Calendar className="h-3 w-3" /> Interview
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            onClick={(e) => e.stopPropagation()}
                            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border bg-card text-foreground hover:bg-surface"
                            aria-label="Actions"
                            title="Actions"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() =>
                              askConfirm([r.id], [r.profiles?.full_name], "shortlisted")
                            }
                          >
                            <CheckCircle2 className="mr-2 h-4 w-4 text-success" /> Shortlist
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              setScheduling({
                                applicationId: r.id,
                                candidateName: r.profiles?.full_name ?? null,
                              })
                            }
                          >
                            <Calendar className="mr-2 h-4 w-4 text-warning" /> Interview
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => askConfirm([r.id], [r.profiles?.full_name], "rejected")}
                          >
                            <XCircle className="mr-2 h-4 w-4 text-muted-foreground" /> Reject
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {inboxTotalPages > 1 && (
            <Pagination
              page={inboxPage}
              totalPages={inboxTotalPages}
              onChange={setInboxPage}
              className="mt-6"
            />
          )}
        </>
      ) : (
        <>
          {!jobFilter ? (
            <div className="rounded-2xl border border-dashed border-border bg-surface p-10 text-center">
              <Filter className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
              <p className="text-sm font-semibold">
                Pick a job in Filter above to see AI-ranked candidates.
              </p>
            </div>
          ) : aiLoading && aiRows.length === 0 ? (
            <div className="h-64 animate-pulse rounded-2xl bg-card" />
          ) : filteredAiRows.length === 0 ? (
            <EmptyResponses
              label={
                aiRows.length > 0
                  ? "No candidates match your filters."
                  : "No applicants yet on this job."
              }
            />
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-card)]">
              {filteredAiRows.map((r, i) => (
                <li
                  key={r.application_id}
                  className="px-3 py-3 transition-colors hover:bg-surface/50 sm:px-4"
                >
                  <div className="flex items-start gap-2.5">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-light text-xs font-bold text-primary ring-1 ring-primary/10">
                      {(r.full_name || "?").slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="grid h-6 w-6 place-items-center rounded-full bg-foreground/5 text-[10px] font-bold tabular-nums text-muted-foreground">
                          #{i + 1}
                        </span>
                        <p className="truncate text-sm font-semibold">
                          {r.full_name || "Candidate"}
                        </p>
                        <span
                          className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-black tabular-nums ${r.score >= 75
                            ? "bg-success text-success-foreground"
                            : r.score >= 50
                              ? "bg-primary text-primary-foreground"
                              : "bg-surface text-muted-foreground"
                            }`}
                        >
                          {r.score}/100
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground sm:text-xs">
                        {r.city ? `${r.city} · ` : ""}
                        {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                      </p>
                      {r.summary && (
                        <p className="mt-1.5 text-xs leading-5 text-foreground/80">{r.summary}</p>
                      )}
                      {r.reasons.length > 0 && (
                        <ul className="mt-1.5 grid gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground sm:grid-cols-2">
                          {r.reasons.slice(0, 4).map((reason, idx) => (
                            <li key={idx} className="flex gap-1.5">
                              <span className="text-primary">•</span>
                              {reason}
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <button
                          onClick={() =>
                            askConfirm([r.application_id], [r.full_name], "shortlisted")
                          }
                          className="inline-flex h-8 items-center gap-1 rounded-lg bg-success px-2.5 text-xs font-semibold text-success-foreground hover:opacity-90"
                        >
                          <CheckCircle2 className="h-3 w-3" /> Shortlist
                        </button>
                        <button
                          onClick={() =>
                            setScheduling({
                              applicationId: r.application_id,
                              candidateName: r.full_name ?? null,
                            })
                          }
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-warning bg-warning-light px-2.5 text-xs font-semibold text-warning"
                        >
                          <Calendar className="h-3 w-3" /> Interview
                        </button>
                        <button
                          onClick={() => askConfirm([r.application_id], [r.full_name], "rejected")}
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2.5 text-xs font-semibold text-muted-foreground hover:bg-surface"
                        >
                          <XCircle className="h-3 w-3" /> Reject
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <AlertDialog
        open={!!pending}
        onOpenChange={(o) => {
          if (!o) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending && pending.ids.length > 1
                ? `Move ${pending.ids.length} candidates to ${pending.label}?`
                : `Move ${pending?.names[0]} to ${pending?.label}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending && pending.ids.length > 1
                ? `${pending.names.slice(0, 5).join(", ")}${pending.names.length > 5 ? ` and ${pending.names.length - 5} more` : ""
                } — this updates their application status right away. You can change it again later if needed.`
                : "This updates the candidate's application status right away. You can change it again later if needed."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendingBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmStatusChange} disabled={pendingBusy}>
              {pendingBusy ? "Updating…" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {reviewing && (
        <ApplicantReviewPanel
          applicant={{
            id: reviewing.id,
            candidate_id: reviewing.candidate_id,
            status: reviewing.status,
            created_at: reviewing.created_at,
            cover_note: reviewing.cover_note,
            expected_salary: reviewing.expected_salary,
            available_from: reviewing.available_from,
            profiles: reviewing.profiles,
            candidate_profiles: cpMap[reviewing.candidate_id] ?? null,
          }}
          onClose={() => setReviewing(null)}
          onStatusChange={(status) =>
            status === "interview"
              ? setScheduling({
                applicationId: reviewing.id,
                candidateName: reviewing.profiles?.full_name ?? null,
              })
              : setStatus([reviewing.id], status)
          }
        />
      )}

      {scheduling && cid && (
        <ScheduleInterviewModal
          open
          onOpenChange={(v) => !v && setScheduling(null)}
          companyId={cid}
          applicationId={scheduling.applicationId}
          candidateName={scheduling.candidateName}
          onScheduled={() => {
            setScheduling(null);
            refetchInbox();
          }}
        />
      )}
    </EmployerShell>
  );
}

function EmptyResponses({ label = "No responses match these filters." }: { label?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-surface p-10 text-center">
      <Inbox className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
      <p className="text-sm font-semibold">{label}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Once candidates apply, they'll show up here in real time.
      </p>
    </div>
  );
}
