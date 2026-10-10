import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import * as XLSX from "xlsx";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Inbox,
  RefreshCw,
  Sparkle,
  XCircle,
  Calendar,
  Download,
  AlertTriangle,
  MoreVertical,
  Search,
  Sparkles,
  UserRound,
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
import { supabase } from "@/integrations/supabase/client";
import { fetchMyCompanies, getActiveCompanyId } from "@/lib/employer";
import { recommendShortlist } from "@/lib/ai-shortlist.functions";
import { buildDownloadDataset } from "@/lib/downloads.functions";
import { mapCrmError, moveStage, type ApplicationStatus } from "@/lib/crm.functions";
import {
  getResponseJobs,
  getJobResponses,
  getResponseStatusCounts,
  type ResponseJobRow,
  type ResponseApplicantRow,
} from "@/lib/responses.functions";

export const Route = createFileRoute("/_authenticated/employer/responses")({
  head: () => ({ meta: [{ title: "Responses · JobsKart Employer" }] }),
  component: ResponsesPage,
});

// "interview" is scheduled through ScheduleInterviewModal, not setStatus(), so
// it never reaches this set from this page — kept to shortlisted/rejected.
const NOTIFY_STATUSES = new Set(["shortlisted", "rejected"]);
const CARD_PAGE_SIZE = 10;

// Row shape the rest of this page (review panel, schedule modal, status
// menu) already speaks — adapted from the flat get_employer_job_responses()
// RPC row so those call sites don't need to change.
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

function toRow(r: ResponseApplicantRow, jobId: string): Row {
  return {
    id: r.id,
    status: r.status,
    created_at: r.created_at,
    candidate_id: r.candidate_id,
    cover_note: r.cover_note,
    expected_salary: r.expected_salary,
    available_from: r.available_from,
    jobs: { id: jobId, title: r.job_title },
    profiles: {
      full_name: r.full_name,
      email: r.email,
      city: r.city,
      avatar_url: r.avatar_url,
      mobile: r.mobile,
    },
  };
}

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

// Inline job filter. Same custom-dropdown shape as StateDropdown
// (src/components/candidate/StateDropdown.tsx) — portaled to document.body
// with position:fixed read off the trigger's own rect (so it can never grow
// page layout or clip at a container edge), same 272px max-height, same
// outside-click/collision-flip handling. Kept local instead of reusing
// StateDropdown directly because StateDropdown's options are plain
// `string`s matched by equality; job titles aren't guaranteed unique, so
// this needs to key by job id while still rendering a "title (count)" label.
// Adds Escape-to-close, arrow-key navigation + Enter-to-select, and focus
// returning to the trigger on close, none of which the generic string
// dropdown needed before now.
const JOB_FILTER_MENU_MAX_HEIGHT = 272;

function JobFilterSelect({
  jobs,
  value,
  onValueChange,
}: {
  jobs: { id: string; title: string; applicantCount: number }[];
  value: string;
  onValueChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlighted, setHighlighted] = useState(-1);
  const [menuPos, setMenuPos] = useState<
    | ({ left: number; width: number } & (
        | { top: number; bottom?: undefined }
        | { top?: undefined; bottom: number }
      ))
    | undefined
  >();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const options = useMemo(
    () => [{ id: "", title: "All jobs", applicantCount: null as number | null }, ...jobs],
    [jobs],
  );
  const visibleOptions = search.trim()
    ? options.filter(
        (o) => o.id === "" || o.title.toLowerCase().includes(search.trim().toLowerCase()),
      )
    : options;
  const selectedLabel = jobs.find((job) => job.id === value)?.title ?? "All jobs";

  const close = () => {
    setOpen(false);
    setSearch("");
    setHighlighted(-1);
    triggerRef.current?.focus();
  };

  const pick = (id: string) => {
    onValueChange(id);
    close();
  };

  // Outside click: the menu is portaled to document.body, so it's not a DOM
  // descendant of containerRef — checked separately, same as StateDropdown,
  // or every click inside the open menu would register as "outside" and
  // close it before the option's own onClick fires.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // position: fixed, computed from the trigger's own screen rect — matches
  // the trigger's width on open-below, flips upward only when there's no
  // room, and can never be clipped by an ancestor's overflow or grow page
  // layout the way an absolutely-positioned descendant could.
  useLayoutEffect(() => {
    if (!open || !containerRef.current) return;
    const updatePosition = () => {
      const rect = containerRef.current!.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const openUpward = spaceBelow < JOB_FILTER_MENU_MAX_HEIGHT + 16 && spaceAbove > spaceBelow;
      setMenuPos(
        openUpward
          ? { bottom: window.innerHeight - rect.top + 4, left: rect.left, width: rect.width }
          : { top: rect.bottom + 4, left: rect.left, width: rect.width },
      );
    };
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  useEffect(() => setHighlighted(-1), [search, open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => (i + 1) % visibleOptions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => (i <= 0 ? visibleOptions.length - 1 : i - 1));
    } else if (e.key === "Enter" && highlighted >= 0) {
      e.preventDefault();
      pick(visibleOptions[highlighted].id);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full sm:w-56">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onKeyDown}
        className="form-input flex h-9 w-full items-center justify-between bg-card text-left text-xs font-semibold"
      >
        <span className="min-w-0 truncate">{selectedLabel}</span>
        <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>
      {open &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label="Job"
            onKeyDown={onKeyDown}
            className="fixed z-[100] box-border flex flex-col overflow-hidden rounded-xl border border-primary/15 bg-popover shadow-xl shadow-primary/10"
            style={{
              top: menuPos.top,
              bottom: menuPos.bottom,
              left: menuPos.left,
              width: menuPos.width,
              maxHeight: Math.min(
                JOB_FILTER_MENU_MAX_HEIGHT,
                typeof window !== "undefined"
                  ? window.innerHeight * 0.5
                  : JOB_FILTER_MENU_MAX_HEIGHT,
              ),
              // Radix Dialog/Sheet sets document.body.style.pointerEvents = "none"
              // while modal; this menu is portaled straight to document.body too,
              // so without this override it silently inherits "none" and every
              // option becomes unclickable even though it's visually on top.
              pointerEvents: "auto",
            }}
          >
            {jobs.length > 6 && (
              <div className="shrink-0 border-b border-border p-1.5">
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Search jobs…"
                  className="form-input h-8 w-full text-xs"
                  autoComplete="off"
                />
              </div>
            )}
            <div className="min-h-0 overflow-x-hidden overflow-y-auto p-1 [scrollbar-width:thin]">
              {visibleOptions.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">No jobs match "{search}".</p>
              ) : (
                visibleOptions.map((option, i) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.id === value}
                    key={option.id || "all"}
                    onClick={() => pick(option.id)}
                    className={`flex min-h-9 w-full items-center justify-between gap-2 rounded-lg px-3 text-left text-sm font-medium ${
                      option.id === value
                        ? "bg-primary text-primary-foreground"
                        : i === highlighted
                          ? "bg-surface text-foreground"
                          : "text-foreground hover:bg-surface"
                    }`}
                  >
                    <span className="min-w-0 truncate">{option.title}</span>
                    {option.applicantCount !== null && (
                      <span className="shrink-0 tabular-nums opacity-70">
                        ({option.applicantCount})
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function ResponsesPage() {
  const queryClient = useQueryClient();
  const [cid, setCid] = useState<string | null>(null);
  // "All jobs" (title-only list) still backs the AI tab's job picker and the
  // recommended-candidates banner; the job FILTER dropdown + per-job cards
  // use the richer, filter-aware getResponseJobs() rows below instead.
  const [jobs, setJobs] = useState<{ id: string; title: string }[]>([]);
  const [jobFilter, setJobFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [nameQuery, setNameQuery] = useState("");
  const [nameQueryDebounced, setNameQueryDebounced] = useState("");
  const [tab, setTab] = useState<"inbox" | "ai">("inbox");
  const [aiRows, setAiRows] = useState<AiRow[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [shortlistN, setShortlistN] = useState(10);
  const [downloading, setDownloading] = useState(false);
  const [expiringCount, setExpiringCount] = useState(0);
  const [recommendedCount, setRecommendedCount] = useState(0);

  // Server-side search, debounced ~300ms so keystrokes don't each fire a query.
  useEffect(() => {
    const id = setTimeout(() => setNameQueryDebounced(nameQuery.trim()), 300);
    return () => clearTimeout(id);
  }, [nameQuery]);

  const [pending, setPending] = useState<PendingStatusChange | null>(null);
  const [pendingBusy, setPendingBusy] = useState(false);

  const [reviewing, setReviewing] = useState<Row | null>(null);

  // Candidate-profile snippet (headline/skills) for whichever candidate the
  // review panel currently has open — fetched on demand rather than for
  // every visible row, since each job card now loads its own rows lazily.
  const { data: reviewingProfile = null } = useQuery({
    queryKey: ["employer-response-candidate-profile", reviewing?.candidate_id],
    enabled: !!reviewing,
    queryFn: async () => {
      const { data } = await supabase
        .from("candidate_profiles")
        .select("user_id, profile_slug, headline, last_role, skills")
        .eq("user_id", reviewing!.candidate_id)
        .maybeSingle();
      return (data ?? null) as ReviewApplicant["candidate_profiles"];
    },
  });
  const [scheduling, setScheduling] = useState<{
    applicationId: string;
    candidateName: string | null;
  } | null>(null);

  const recommend = useServerFn(recommendShortlist);
  const buildDownload = useServerFn(buildDownloadDataset);
  const move = useServerFn(moveStage);

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

  const getResponseJobsFn = useServerFn(getResponseJobs);
  const getJobResponsesFn = useServerFn(getJobResponses);

  // One call loads every job card's header + applicant count (status/search
  // already applied), scoped to active jobs only — this is also the source
  // of the job filter dropdown's "title (count)" rows and its "All jobs"
  // total. placeholderData keeps the previous grouping on screen while a new
  // filter's request is in flight, so cards don't flash empty.
  const {
    data: jobGroups = [],
    isLoading: jobGroupsLoading,
    isFetching: jobGroupsFetching,
    refetch: refetchJobGroups,
  } = useQuery({
    queryKey: ["employer-responses-jobs", cid, statusFilter, nameQueryDebounced],
    enabled: !!cid,
    placeholderData: (prev) => prev,
    queryFn: () =>
      getResponseJobsFn({
        data: {
          companyId: cid!,
          status: statusFilter || undefined,
          query: nameQueryDebounced || undefined,
        },
      }),
  });

  const visibleJobGroups = useMemo(
    () => (jobFilter ? jobGroups.filter((j) => j.job_id === jobFilter) : jobGroups),
    [jobGroups, jobFilter],
  );

  // Status chip bar: counts for every status at once, scoped to the selected
  // job (or all jobs) and the current search — independent of statusFilter,
  // which only narrows the job cards below.
  const getResponseStatusCountsFn = useServerFn(getResponseStatusCounts);
  const { data: chipCounts = {} } = useQuery({
    queryKey: ["employer-responses-chip-counts", cid, jobFilter, nameQueryDebounced],
    enabled: !!cid,
    placeholderData: (prev) => prev,
    queryFn: () =>
      getResponseStatusCountsFn({
        data: {
          companyId: cid!,
          jobId: jobFilter || undefined,
          query: nameQueryDebounced || undefined,
        },
      }),
  });

  const loading = jobGroupsLoading;
  const inboxTotal = chipCounts.all ?? 0;

  // A status change or a new interview moves a candidate between job-card
  // rows and chip counts that live in three separately-keyed queries
  // (job groups, chip counts, and each card's own applicant page) — refetch
  // alone only covers the first, so a mutation invalidates all three by key
  // prefix instead.
  const refetchInbox = () => {
    refetchJobGroups();
    queryClient.invalidateQueries({ queryKey: ["employer-responses-chip-counts"] });
    queryClient.invalidateQueries({ queryKey: ["employer-job-responses"] });
  };

  // Per-card pagination: each job card owns its own page of applicants,
  // fetched only once the card is actually on screen. "Show more" bumps the
  // card's limit rather than paging — matches the spec's "10 per card + Show
  // more" rather than a page-number control inside each card.
  const [cardLimits, setCardLimits] = useState<Record<string, number>>({});
  const cardLimit = (jobId: string) => cardLimits[jobId] ?? CARD_PAGE_SIZE;

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
    try {
      await move({
        data: { applicationIds: ids, status: status as ApplicationStatus },
      });
    } catch (e) {
      toast.error(mapCrmError(e instanceof Error ? e.message : "Update failed"));
      return;
    }
    toast.success(`Marked ${ids.length} as ${status}`);
    refetchInbox();
    if (NOTIFY_STATUSES.has(status)) {
      for (const id of ids) {
        supabase.functions
          .invoke("application-status-notify", { body: { applicationId: id, status } })
          .catch(() => {});
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

  const clearAllFilters = () => {
    setNameQuery("");
    setJobFilter("");
    setStatusFilter("");
  };

  const loadAi = async (refresh = false) => {
    // "All jobs" (empty jobFilter) is a valid selection: rank across the company's jobs.
    if (!jobFilter && !cid) return;
    setAiLoading(true);
    try {
      const data = await recommend({
        data: jobFilter ? { jobId: jobFilter, refresh } : { companyId: cid!, refresh },
      });
      setAiRows(data as AiRow[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI failed");
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    if (tab === "ai" && (jobFilter || cid)) loadAi(false);
    // eslint-disable-next-line
  }, [tab, jobFilter, cid]);

  // Job-specific AI recommendations quick-action: when a job is selected,
  // surface how many database candidates match it but haven't applied yet.
  useEffect(() => {
    if (!jobFilter) {
      setRecommendedCount(0);
      return;
    }
    let cancelled = false;
    supabase
      .rpc("get_recommended_candidates_for_job", {
        _job_id: jobFilter,
        _limit: 1,
        _offset: 0,
        _min_score: 40,
      })
      .then(({ data, error }) => {
        if (cancelled || error) return;
        const rows = (data ?? []) as Array<{ total_count: number }>;
        setRecommendedCount(rows[0]?.total_count ?? 0);
      });
    return () => {
      cancelled = true;
    };
  }, [jobFilter]);

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
          Responses for expired jobs stay downloadable for 7 days after expiry, then get locked, and
          are permanently removed 60 days after expiry. Download important candidates in time.
          {expiringCount > 0 ? ` (${expiringCount} job(s) expiring soon)` : ""}
        </span>
      </div>

      {jobFilter && recommendedCount > 0 && (
        <Link
          to="/employer/jobs/$jobId/applicants"
          params={{ jobId: jobFilter }}
          search={{ source: "recommended" }}
          className="mb-3 flex items-center gap-3 rounded-xl border border-primary/20 bg-primary-light/40 px-4 py-3 transition-colors hover:bg-primary-light/60"
        >
          <Sparkles className="h-5 w-5 shrink-0 text-primary" />
          <p className="min-w-0 text-sm text-foreground">
            We found <strong>{recommendedCount} matching candidates</strong> for{" "}
            {jobs.find((j) => j.id === jobFilter)?.title ?? "this job"} who haven't applied yet.
            <span className="ml-1 font-semibold text-primary">View AI Recommended Profiles →</span>
          </p>
        </Link>
      )}

      <div className="mb-3 inline-flex max-w-full gap-1 rounded-lg border border-border bg-card p-1">
        <button
          onClick={() => setTab("inbox")}
          className={`flex items-center justify-center gap-1.5 rounded-md px-4 py-1.5 text-xs font-semibold transition-colors ${
            tab === "inbox"
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
          className={`flex items-center justify-center gap-1.5 rounded-md px-4 py-1.5 text-xs font-semibold transition-colors ${
            tab === "ai"
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

        {tab === "inbox" && (
          <JobFilterSelect
            jobs={jobGroups.map((j) => ({
              id: j.job_id,
              title: j.job_title,
              applicantCount: j.applicant_count,
            }))}
            value={jobFilter}
            onValueChange={setJobFilter}
          />
        )}

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
              disabled={aiLoading}
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
                disabled={aiLoading || eligibleAiRows.length === 0}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-success px-3 text-xs font-semibold text-success-foreground disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Shortlist top {shortlistN}
              </button>
            </div>
          </>
        )}
      </section>

      {tab === "inbox" && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px]">
          <button
            type="button"
            onClick={() => setStatusFilter("")}
            className={`rounded-full border px-2.5 py-1 font-semibold transition-colors ${
              !statusFilter
                ? "border-primary/20 bg-primary-light text-primary"
                : "border-border bg-card text-muted-foreground hover:bg-surface"
            }`}
          >
            All <span className="ml-1 tabular-nums">{chipCounts.all ?? 0}</span>
          </button>
          {APPLICANT_STATUSES.map((status) => (
            <button
              type="button"
              key={status.id}
              onClick={() => setStatusFilter(status.id)}
              className={`rounded-full border px-2.5 py-1 font-medium transition-colors ${
                statusFilter === status.id
                  ? "border-primary/20 bg-primary-light text-primary"
                  : "border-border bg-card text-muted-foreground hover:bg-surface"
              }`}
            >
              {status.label}{" "}
              <span
                className={`ml-1 font-semibold tabular-nums ${statusFilter === status.id ? "text-primary" : "text-foreground"}`}
              >
                {chipCounts[status.id] ?? 0}
              </span>
            </button>
          ))}
        </div>
      )}

      {tab === "inbox" ? (
        <>
          {loading && jobGroups.length === 0 ? (
            <div className="grid gap-3">
              <div className="h-48 animate-pulse rounded-2xl bg-card" />
              <div className="h-48 animate-pulse rounded-2xl bg-card" />
            </div>
          ) : visibleJobGroups.length === 0 ? (
            nameQuery || jobFilter || statusFilter ? (
              <EmptyResponses label="No responses match these filters." onClear={clearAllFilters} />
            ) : (
              <EmptyResponses />
            )
          ) : (
            <div className={`grid gap-3 ${jobGroupsFetching ? "opacity-60" : ""}`}>
              {visibleJobGroups.map((group) => (
                <JobResponseCard
                  key={group.job_id}
                  companyId={cid!}
                  group={group}
                  statusFilter={statusFilter}
                  query={nameQueryDebounced}
                  limit={cardLimit(group.job_id)}
                  onShowMore={() =>
                    setCardLimits((prev) => ({
                      ...prev,
                      [group.job_id]: cardLimit(group.job_id) + CARD_PAGE_SIZE,
                    }))
                  }
                  getJobResponsesFn={getJobResponsesFn}
                  onReview={setReviewing}
                  onAskConfirm={askConfirm}
                  onSchedule={setScheduling}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {aiLoading && aiRows.length === 0 ? (
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
                          className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-black tabular-nums ${
                            r.score >= 75
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
                ? `${pending.names.slice(0, 5).join(", ")}${
                    pending.names.length > 5 ? ` and ${pending.names.length - 5} more` : ""
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
            candidate_profiles: reviewingProfile,
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

function EmptyResponses({
  label = "No applications yet.",
  onClear,
}: {
  label?: string;
  onClear?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-surface p-10 text-center">
      <Inbox className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
      <p className="text-sm font-semibold">{label}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {onClear
          ? "Try a different search, job, or status."
          : "Once candidates apply, they'll show up here in real time."}
      </p>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="mt-3 inline-flex h-8 items-center rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-surface"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

// One job's card: header (title, status, applicant count) + its own
// paginated table of applicants, fetched independently of every other card
// so opening "All jobs" with many jobs doesn't load every job's full
// applicant list at once.
function JobResponseCard({
  companyId,
  group,
  statusFilter,
  query,
  limit,
  onShowMore,
  getJobResponsesFn,
  onReview,
  onAskConfirm,
  onSchedule,
}: {
  companyId: string;
  group: ResponseJobRow;
  statusFilter: string;
  query: string;
  limit: number;
  onShowMore: () => void;
  getJobResponsesFn: (opts: {
    data: {
      companyId: string;
      jobId: string;
      status?: string;
      query?: string;
      limit?: number;
      offset?: number;
    };
  }) => Promise<ResponseApplicantRow[]>;
  onReview: (row: Row) => void;
  onAskConfirm: (ids: string[], names: Array<string | null | undefined>, status: string) => void;
  onSchedule: (s: { applicationId: string; candidateName: string | null }) => void;
}) {
  const { data: apiRows = [], isLoading } = useQuery({
    queryKey: ["employer-job-responses", group.job_id, statusFilter, query, limit],
    placeholderData: (prev) => prev,
    queryFn: () =>
      getJobResponsesFn({
        data: {
          companyId,
          jobId: group.job_id,
          status: statusFilter || undefined,
          query: query || undefined,
          limit,
          offset: 0,
        },
      }),
  });

  const rows = useMemo(() => apiRows.map((r) => toRow(r, group.job_id)), [apiRows, group.job_id]);
  const totalForCard = apiRows[0]?.total_count ?? group.applicant_count;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-card)]">
      <Link
        to="/employer/jobs/$jobId/applicants"
        params={{ jobId: group.job_id }}
        className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-surface/50"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{group.job_title}</span>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
              group.job_status === "active"
                ? "bg-success-light text-success"
                : "bg-surface text-muted-foreground"
            }`}
          >
            {group.job_status}
          </span>
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {totalForCard} applicant{totalForCard === 1 ? "" : "s"}
          </span>
        </span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </Link>

      {isLoading && rows.length === 0 ? (
        <div className="h-24 animate-pulse border-t border-border bg-surface/40" />
      ) : rows.length === 0 ? (
        <p className="border-t border-border px-4 py-6 text-center text-xs text-muted-foreground">
          No candidates match these filters for this job.
        </p>
      ) : (
        <div className="border-t border-border">
          <div
            role="row"
            className="hidden grid-cols-[minmax(12rem,1.5fr)_minmax(8rem,.85fr)_minmax(7rem,.7fr)_minmax(6rem,.55fr)] gap-4 border-b border-border bg-surface/60 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground min-[900px]:grid"
          >
            <span role="columnheader">Candidate</span>
            <span role="columnheader">Applied</span>
            <span role="columnheader" className="text-center">
              Status
            </span>
            <span role="columnheader" className="pr-4 text-right">
              Actions
            </span>
          </div>
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li
                key={r.id}
                role="row"
                className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1.5 px-3 py-2.5 sm:px-4 min-[900px]:grid-cols-[minmax(12rem,1.5fr)_minmax(8rem,.85fr)_minmax(7rem,.7fr)_minmax(6rem,.55fr)] min-[900px]:gap-4"
              >
                <div role="cell" className="flex min-w-0 items-center gap-2.5">
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
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {r.profiles?.full_name || "Candidate"}
                    </p>
                    {r.profiles?.city && (
                      <p className="truncate text-[11px] text-muted-foreground">
                        {r.profiles.city}
                      </p>
                    )}
                  </div>
                </div>

                <div
                  role="cell"
                  className="col-start-1 row-start-2 pl-[2.875rem] text-[11px] text-muted-foreground min-[900px]:col-auto min-[900px]:row-auto min-[900px]:pl-0 min-[900px]:text-sm min-[900px]:text-foreground"
                >
                  {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                </div>

                <div
                  role="cell"
                  className="col-start-2 row-start-1 flex justify-end self-start min-[900px]:col-auto min-[900px]:row-auto min-[900px]:justify-center min-[900px]:self-center"
                >
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${applicantStatusTone(r.status)}`}
                  >
                    {applicantStatusLabel(r.status)}
                  </span>
                </div>

                <div
                  role="cell"
                  className="col-start-2 row-start-2 flex items-center justify-end gap-1.5 self-center min-[900px]:col-auto min-[900px]:row-auto min-[900px]:pr-4"
                >
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
                      <DropdownMenuItem onClick={() => onReview(r)}>
                        <UserRound className="mr-2 h-4 w-4" /> Profile
                      </DropdownMenuItem>
                      {r.status === "applied" && (
                        <DropdownMenuItem
                          onClick={() =>
                            onAskConfirm([r.id], [r.profiles?.full_name], "shortlisted")
                          }
                        >
                          <CheckCircle2 className="mr-2 h-4 w-4 text-success" /> Shortlist
                        </DropdownMenuItem>
                      )}
                      {(r.status === "applied" || r.status === "shortlisted") && (
                        <DropdownMenuItem
                          onClick={() =>
                            onSchedule({
                              applicationId: r.id,
                              candidateName: r.profiles?.full_name ?? null,
                            })
                          }
                        >
                          <Calendar className="mr-2 h-4 w-4 text-warning" /> Interview
                        </DropdownMenuItem>
                      )}
                      {r.status !== "hired" && r.status !== "rejected" && (
                        <DropdownMenuItem
                          onClick={() => onAskConfirm([r.id], [r.profiles?.full_name], "rejected")}
                        >
                          <XCircle className="mr-2 h-4 w-4 text-muted-foreground" /> Reject
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            ))}
          </ul>
          {rows.length < totalForCard && (
            <div className="border-t border-border p-2.5 text-center">
              <button
                type="button"
                onClick={onShowMore}
                className="inline-flex h-8 items-center rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-surface"
              >
                Show more
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
