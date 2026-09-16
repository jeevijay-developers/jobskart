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
} from "lucide-react";
import { EmployerShell } from "@/components/employer/EmployerShell";
import {
  ApplicantReviewPanel,
  type ReviewApplicant,
} from "@/components/employer/ApplicantReviewPanel";
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

export const Route = createFileRoute("/_authenticated/employer/responses")({
  head: () => ({ meta: [{ title: "Responses · JobsKart Employer" }] }),
  component: ResponsesPage,
});

const NOTIFY_STATUSES = new Set(["shortlisted", "interview", "rejected"]);

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

type PendingStatusChange = { id: string; name: string; status: string; label: string };

function ResponsesPage() {
  const [cid, setCid] = useState<string | null>(null);
  const [jobs, setJobs] = useState<{ id: string; title: string }[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [jobFilter, setJobFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [nameQuery, setNameQuery] = useState("");
  const [tab, setTab] = useState<"inbox" | "ai">("inbox");
  const [aiRows, setAiRows] = useState<AiRow[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [expiringCount, setExpiringCount] = useState(0);

  const [filterOpen, setFilterOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [jobDraft, setJobDraft] = useState("");

  const [pending, setPending] = useState<PendingStatusChange | null>(null);
  const [pendingBusy, setPendingBusy] = useState(false);

  const [cpMap, setCpMap] = useState<Record<string, ReviewApplicant["candidate_profiles"]>>({});
  const [reviewing, setReviewing] = useState<Row | null>(null);

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
      if (!id) {
        setLoading(false);
        return;
      }
      setCid(id);
      const { data: js } = await supabase
        .from("jobs")
        .select("id, title")
        .eq("company_id", id)
        .order("created_at", { ascending: false });
      setJobs(js || []);
    })();
  }, []);

  const load = async () => {
    if (!cid) return;
    setLoading(true);
    let qy = supabase
      .from("applications")
      .select(
        "id, status, created_at, candidate_id, cover_note, expected_salary, available_from, jobs!inner (id, title, company_id), profiles!candidate_id (full_name, email, city, avatar_url, mobile)",
      )
      .eq("jobs.company_id", cid)
      .order("created_at", { ascending: false })
      .limit(200);
    if (jobFilter) qy = qy.eq("job_id", jobFilter);
    if (statusFilter) qy = qy.eq("status", statusFilter as never);
    const { data, error } = await qy;
    if (error) toast.error(error.message);
    const loaded = (data || []) as unknown as Row[];
    setRows(loaded);
    setLoading(false);

    const candidateIds = Array.from(new Set(loaded.map((r) => r.candidate_id)));
    if (candidateIds.length) {
      const { data: cps } = await supabase
        .from("candidate_profiles")
        .select("user_id, profile_slug, headline, last_role, skills")
        .in("user_id", candidateIds);
      setCpMap(Object.fromEntries((cps || []).map((c) => [c.user_id, c])));
    }
  };

  useEffect(() => {
    if (cid) load(); /* eslint-disable-next-line */
  }, [cid, jobFilter, statusFilter]);

  const filtered = useMemo(() => {
    if (!nameQuery.trim()) return rows;
    const needle = nameQuery.toLowerCase();
    return rows.filter((r) => (r.profiles?.full_name || "").toLowerCase().includes(needle));
  }, [rows, nameQuery]);

  const filteredAiRows = useMemo(() => {
    if (!nameQuery.trim()) return aiRows;
    const needle = nameQuery.toLowerCase();
    return aiRows.filter((r) => (r.full_name || "").toLowerCase().includes(needle));
  }, [aiRows, nameQuery]);

  const setStatus = async (ids: string[], status: string) => {
    setRows((p) => p.map((r) => (ids.includes(r.id) ? { ...r, status } : r)));
    setReviewing((r) => (r && ids.includes(r.id) ? { ...r, status } : r));
    const { error } = await supabase
      .from("applications")
      .update({ status } as never)
      .in("id", ids);
    if (error) {
      toast.error(error.message);
      load();
      return;
    }
    toast.success(`Marked ${ids.length} as ${status}`);
    if (NOTIFY_STATUSES.has(status)) {
      for (const id of ids) {
        supabase.functions
          .invoke("application-status-notify", { body: { applicationId: id, status } })
          .catch(() => {});
      }
    }
  };

  const askConfirm = (id: string, name: string | null | undefined, status: string) => {
    setPending({
      id,
      name: name || "this candidate",
      status,
      label: applicantStatusLabel(status),
    });
  };

  const confirmStatusChange = async () => {
    if (!pending) return;
    setPendingBusy(true);
    await setStatus([pending.id], pending.status);
    setPendingBusy(false);
    setPending(null);
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
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-surface disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="sm:hidden">Excel</span>
            <span className="hidden sm:inline">Excel (max 300/day)</span>
          </button>
          <button
            onClick={load}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-surface"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      }
    >
      <div className="mb-4 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning-light p-3 text-xs text-warning">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Responses for expired jobs stay accessible for 7 days after expiry, then get locked.
          Download important candidates in time.
          {expiringCount > 0 ? ` (${expiringCount} job(s) expiring soon)` : ""}
        </span>
      </div>

      <div className="mb-4 flex gap-1 rounded-xl border border-border bg-card p-1">
        <button
          onClick={() => setTab("inbox")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
            tab === "inbox"
              ? "bg-primary text-primary-foreground"
              : "text-foreground/70 hover:bg-surface"
          }`}
        >
          <Inbox className="h-4 w-4" /> Inbox{" "}
          <span className="rounded-full bg-black/10 px-1.5 text-[10px] tabular-nums">
            {filtered.length}
          </span>
        </button>
        <button
          onClick={() => setTab("ai")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
            tab === "ai"
              ? "bg-primary text-primary-foreground"
              : "text-foreground/70 hover:bg-surface"
          }`}
        >
          <Sparkle className="h-4 w-4" /> AI shortlist
        </button>
      </div>

      <section className="mb-4 flex flex-wrap items-center gap-2">
        <Sheet open={filterOpen} onOpenChange={(o) => (o ? openFilters() : setFilterOpen(false))}>
          <SheetTrigger asChild>
            <button
              type="button"
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-semibold hover:bg-surface"
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
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-semibold hover:bg-surface"
              >
                {statusFilter ? applicantStatusLabel(statusFilter) : "All statuses"}
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup
                value={statusFilter || "all"}
                onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}
              >
                <DropdownMenuRadioItem value="all">All statuses</DropdownMenuRadioItem>
                {APPLICANT_STATUSES.map((s) => (
                  <DropdownMenuRadioItem key={s.id} value={s.id}>
                    {s.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <button
            onClick={() => loadAi(true)}
            disabled={!jobFilter || aiLoading}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-primary bg-primary-light px-3 text-sm font-semibold text-primary disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${aiLoading ? "animate-spin" : ""}`} /> Re-rank
          </button>
        )}
      </section>

      {tab === "inbox" ? (
        <>
          {loading ? (
            <div className="h-64 animate-pulse rounded-2xl bg-card" />
          ) : filtered.length === 0 ? (
            <EmptyResponses />
          ) : (
            <ul className="space-y-2">
              {filtered.map((r) => {
                return (
                  <li
                    key={r.id}
                    onClick={() => setReviewing(r)}
                    className="flex cursor-pointer items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-[var(--shadow-card)] hover:border-primary/40 sm:p-4"
                  >
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-light text-sm font-bold text-primary">
                      {(r.profiles?.full_name || "?").slice(0, 1).toUpperCase()}
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
                      <p className="truncate text-xs text-muted-foreground">
                        {r.jobs?.title} {r.profiles?.city ? `· ${r.profiles.city}` : ""}
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                      </p>
                    </div>
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
                          onClick={() => askConfirm(r.id, r.profiles?.full_name, "shortlisted")}
                        >
                          <CheckCircle2 className="mr-2 h-4 w-4 text-success" /> Shortlist
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => askConfirm(r.id, r.profiles?.full_name, "interview")}
                        >
                          <Calendar className="mr-2 h-4 w-4 text-warning" /> Interview
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => askConfirm(r.id, r.profiles?.full_name, "rejected")}
                        >
                          <XCircle className="mr-2 h-4 w-4 text-muted-foreground" /> Reject
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                );
              })}
            </ul>
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
            <ul className="space-y-2">
              {filteredAiRows.map((r, i) => (
                <li
                  key={r.application_id}
                  className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]"
                >
                  <div className="flex items-start gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-light text-sm font-bold text-primary">
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
                          className={`ml-auto rounded-full px-2.5 py-1 text-xs font-black tabular-nums ${
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
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {r.city} ·{" "}
                        {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                      </p>
                      {r.summary && <p className="mt-2 text-sm text-foreground/80">{r.summary}</p>}
                      {r.reasons.length > 0 && (
                        <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                          {r.reasons.slice(0, 4).map((reason, idx) => (
                            <li key={idx} className="flex gap-1.5">
                              <span className="text-primary">•</span>
                              {reason}
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <button
                          onClick={() => askConfirm(r.application_id, r.full_name, "shortlisted")}
                          className="inline-flex h-8 items-center gap-1 rounded-lg bg-success px-2.5 text-xs font-semibold text-success-foreground hover:opacity-90"
                        >
                          <CheckCircle2 className="h-3 w-3" /> Shortlist
                        </button>
                        <button
                          onClick={() => askConfirm(r.application_id, r.full_name, "interview")}
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-warning bg-warning-light px-2.5 text-xs font-semibold text-warning"
                        >
                          <Calendar className="h-3 w-3" /> Interview
                        </button>
                        <button
                          onClick={() => askConfirm(r.application_id, r.full_name, "rejected")}
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
              Move {pending?.name} to {pending?.label}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This updates the candidate's application status right away. You can change it again
              later if needed.
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
          onStatusChange={(status) => setStatus([reviewing.id], status)}
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
