import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Calendar, ChevronRight, ExternalLink, MoreVertical, Video } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { EmployerShell } from "@/components/employer/EmployerShell";
import { RescheduleInterviewModal } from "@/components/employer/RescheduleInterviewModal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { getActiveCompanyId, fetchMyCompanies } from "@/lib/employer";
import { getJoinWindowState } from "@/lib/interview-window";
import { getHostStartUrl, cancelInterview } from "@/lib/interview.functions";

export const Route = createFileRoute("/_authenticated/employer/interviews")({
  head: () => ({ meta: [{ title: "Interviews · JobsKart" }] }),
  component: Page,
});

type InterviewRow = {
  id: string;
  application_id: string | null;
  job_id: string | null;
  candidate_id: string;
  mode: string;
  provider: string;
  scheduled_at: string;
  duration_min: number;
  status: string;
  location: string | null;
  meeting_url: string | null;
  notes: string | null;
  jobs: { title: string } | null;
  candidateName: string | null;
  candidateCity: string | null;
};

async function resolveCompanyId(): Promise<string | null> {
  let cid = getActiveCompanyId();
  if (!cid) {
    const { data: u } = await supabase.auth.getUser();
    if (u.user) {
      const ms = await fetchMyCompanies(u.user.id);
      cid = ms[0]?.company_id ?? null;
    }
  }
  return cid;
}

async function fetchInterviews(cid: string): Promise<InterviewRow[]> {
  const { data, error } = await supabase
    .from("interviews")
    .select(
      "id, application_id, job_id, candidate_id, mode, provider, scheduled_at, duration_min, status, location, meeting_url, notes, jobs (title)",
    )
    .eq("company_id", cid)
    .order("scheduled_at", { ascending: true });
  if (error) throw error;

  const rows = (data || []) as unknown as Array<
    Omit<InterviewRow, "candidateName" | "candidateCity">
  >;
  const candidateIds = Array.from(new Set(rows.map((r) => r.candidate_id)));
  let profileMap: Record<string, { full_name: string | null; city: string | null }> = {};
  if (candidateIds.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, city")
      .in("id", candidateIds);
    profileMap = Object.fromEntries((profiles || []).map((p) => [p.id, p]));
  }

  const withNames = rows.map((r) => ({
    ...r,
    candidateName: profileMap[r.candidate_id]?.full_name ?? null,
    candidateCity: profileMap[r.candidate_id]?.city ?? null,
  }));

  // Upcoming/active interviews soonest-first; past/cancelled/completed most-recent-first.
  const now = new Date();
  const isDone = (r: InterviewRow) =>
    r.status === "cancelled" ||
    r.status === "completed" ||
    getJoinWindowState(r.scheduled_at, r.duration_min, now) === "expired";
  const upcoming = withNames.filter((r) => !isDone(r));
  const past = withNames.filter(isDone).reverse();
  return [...upcoming, ...past];
}

type Badge = { label: string; tone: string };

function getBadge(iv: InterviewRow, now: Date): Badge {
  if (iv.status === "cancelled")
    return { label: "Cancelled", tone: "bg-surface text-muted-foreground" };
  if (iv.status === "completed")
    return { label: "Completed", tone: "bg-success-light text-success" };

  const windowState = getJoinWindowState(iv.scheduled_at, iv.duration_min, now);
  if (windowState === "open") {
    return { label: "Live now", tone: "bg-success text-success-foreground" };
  }
  if (windowState === "expired") {
    return { label: "Time passed", tone: "bg-surface text-muted-foreground" };
  }
  const minutesToStart = (new Date(iv.scheduled_at).getTime() - now.getTime()) / 60_000;
  if (minutesToStart <= 60)
    return { label: "Starting soon", tone: "bg-warning-light text-warning" };
  return {
    label: iv.status === "rescheduled" ? "Rescheduled" : "Scheduled",
    tone: "bg-primary-light text-primary",
  };
}

function isActionable(status: string) {
  return status !== "cancelled" && status !== "completed";
}

type JobGroup = { jobId: string; jobTitle: string; interviews: InterviewRow[] };

// Groups interviews by job while preserving fetchInterviews' existing sort
// (upcoming soonest-first, then past most-recent-first) inside each group —
// grouping never re-sorts, it only buckets the already-ordered rows.
function groupByJob(interviews: InterviewRow[]): JobGroup[] {
  const order: string[] = [];
  const groups = new Map<string, JobGroup>();
  for (const iv of interviews) {
    const key = iv.job_id ?? "no-job";
    let group = groups.get(key);
    if (!group) {
      group = { jobId: key, jobTitle: iv.jobs?.title || "Job", interviews: [] };
      groups.set(key, group);
      order.push(key);
    }
    group.interviews.push(iv);
  }
  return order.map((key) => groups.get(key)!);
}

function Page() {
  const runGetHostStartUrl = useServerFn(getHostStartUrl);
  const runCancel = useServerFn(cancelInterview);

  const [rescheduling, setRescheduling] = useState<InterviewRow | null>(null);
  const [cancelling, setCancelling] = useState<InterviewRow | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const { data: cid } = useQuery({
    queryKey: ["employer-interviews-cid"],
    queryFn: resolveCompanyId,
  });
  const {
    data: interviews = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["employer-interviews", cid],
    queryFn: () => fetchInterviews(cid!),
    enabled: !!cid,
  });

  const now = new Date();
  const jobGroups = groupByJob(interviews);

  const joinAsHost = async (iv: InterviewRow) => {
    if (!cid) return;
    setJoiningId(iv.id);
    try {
      const { startUrl } = await runGetHostStartUrl({
        data: { companyId: cid, interviewId: iv.id },
      });
      window.open(startUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't open the host link");
    } finally {
      setJoiningId(null);
    }
  };

  const confirmCancel = async () => {
    if (!cancelling || !cid) return;
    setCancelBusy(true);
    try {
      await runCancel({
        data: { companyId: cid, interviewId: cancelling.id, reason: "Cancelled by employer" },
      });
      toast.success("Interview cancelled");
      setCancelling(null);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't cancel the interview");
    } finally {
      setCancelBusy(false);
    }
  };

  return (
    <EmployerShell
      title="Interviews"
      subtitle="Every interview you've scheduled, across all your jobs"
    >
      {isLoading ? (
        <div className="h-64 animate-pulse rounded-xl bg-card" />
      ) : !interviews.length ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <Calendar className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            No interviews scheduled yet. Schedule one from an applicant's card.
          </p>
        </div>
      ) : (
        <>
          {/* Mobile (below lg:): one flat card per interview, unchanged. */}
          <div className="grid gap-3 lg:hidden">
            {interviews.map((iv) => {
              const badge = getBadge(iv, now);
              const canJoinAsHost =
                iv.provider === "jobskart_zoom" &&
                isActionable(iv.status) &&
                getJoinWindowState(iv.scheduled_at, iv.duration_min, now) === "open";

              return (
                <div
                  key={iv.id}
                  className="rounded-xl border border-border bg-card shadow-[var(--shadow-card)]"
                >
                  {iv.job_id && (
                    <Link
                      to="/employer/jobs/$jobId/applicants"
                      params={{ jobId: iv.job_id }}
                      className="flex items-center justify-between gap-2 border-b border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-primary"
                    >
                      <span className="truncate">{iv.jobs?.title || "Job"}</span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                    </Link>
                  )}
                  <div className="flex items-start gap-3 p-4">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-light text-sm font-semibold text-primary">
                      {(iv.candidateName || "?").slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {iv.candidateName || "Candidate"}
                        </p>
                        <p className="shrink-0 whitespace-nowrap text-xs font-medium text-foreground">
                          {format(new Date(iv.scheduled_at), "eee, dd MMM yyyy · h:mm a")}
                        </p>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${badge.tone}`}
                        >
                          {badge.label}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {iv.duration_min} min ·{" "}
                        {iv.provider === "jobskart_zoom" ? "JobsKart Video" : iv.mode}
                      </p>
                      {iv.notes && (
                        <p className="mt-2 rounded-lg bg-surface p-2 text-xs">{iv.notes}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {canJoinAsHost && (
                        <button
                          onClick={() => joinAsHost(iv)}
                          disabled={joiningId === iv.id}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-success px-2.5 text-xs font-semibold text-success-foreground hover:opacity-90 disabled:opacity-50"
                        >
                          <Video className="h-3.5 w-3.5" /> Join as host
                        </button>
                      )}
                      {iv.provider === "external_link" && iv.meeting_url && (
                        <a
                          href={iv.meeting_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-semibold hover:bg-surface"
                        >
                          <ExternalLink className="h-3.5 w-3.5" /> Link
                        </a>
                      )}
                      {isActionable(iv.status) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border hover:bg-surface"
                              aria-label="Actions"
                            >
                              <MoreVertical className="h-3.5 w-3.5" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setRescheduling(iv)}>
                              Reschedule
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setCancelling(iv)}
                              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                            >
                              Cancel
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop (lg: and up): interviews grouped visually by job. The
              header's arrow is a plain navigation link to that job's
              applicants page (job_id-driven, works for any job) — it is NOT
              an expand/collapse toggle, so every group's rows always show. */}
          <div className="hidden gap-3 lg:grid">
            {jobGroups.map((group) => {
              return (
                <div
                  key={group.jobId}
                  className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-card)]"
                >
                  {group.jobId !== "no-job" && (
                    <Link
                      to="/employer/jobs/$jobId/applicants"
                      params={{ jobId: group.jobId }}
                      className="flex items-center justify-between gap-2 px-4 py-2.5 text-xs font-semibold text-muted-foreground hover:text-primary"
                    >
                      <span className="truncate">{group.jobTitle}</span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                    </Link>
                  )}
                  <div className="border-t border-border">
                      <div
                        role="row"
                        className="grid grid-cols-[minmax(14rem,1.6fr)_minmax(3.5rem,.5fr)_minmax(8rem,.9fr)_minmax(6rem,.7fr)_minmax(7rem,.7fr)_minmax(6rem,.6fr)] items-center gap-4 border-b border-border bg-surface/60 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
                      >
                        <span role="columnheader">Candidate</span>
                        <span role="columnheader">Day</span>
                        <span role="columnheader">Date</span>
                        <span role="columnheader">Time</span>
                        <span role="columnheader" className="text-center">
                          Status
                        </span>
                        <span role="columnheader" className="text-right">
                          Actions
                        </span>
                      </div>
                      <div className="divide-y divide-border">
                        {group.interviews.map((iv) => {
                          const badge = getBadge(iv, now);
                          const canJoinAsHost =
                            iv.provider === "jobskart_zoom" &&
                            isActionable(iv.status) &&
                            getJoinWindowState(iv.scheduled_at, iv.duration_min, now) === "open";
                          const scheduledDate = new Date(iv.scheduled_at);

                          return (
                            <div
                              key={iv.id}
                              role="row"
                              className="grid grid-cols-[minmax(14rem,1.6fr)_minmax(3.5rem,.5fr)_minmax(8rem,.9fr)_minmax(6rem,.7fr)_minmax(7rem,.7fr)_minmax(6rem,.6fr)] items-center gap-4 px-4 py-3 transition-colors hover:bg-surface/70"
                            >
                              <div role="cell" className="flex min-w-0 items-center gap-3">
                                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-light text-sm font-semibold text-primary">
                                  {(iv.candidateName || "?").slice(0, 1).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-foreground">
                                    {iv.candidateName || "Candidate"}
                                  </p>
                                  <p className="truncate text-xs text-muted-foreground">
                                    {iv.duration_min} min ·{" "}
                                    {iv.provider === "jobskart_zoom" ? "JobsKart Video" : iv.mode}
                                  </p>
                                </div>
                              </div>
                              <div role="cell" className="text-sm text-foreground">
                                {format(scheduledDate, "eee")}
                              </div>
                              <div role="cell" className="text-sm text-foreground">
                                {format(scheduledDate, "dd MMM yyyy")}
                              </div>
                              <div role="cell" className="text-sm text-foreground">
                                {format(scheduledDate, "h:mm a")}
                              </div>
                              <div role="cell" className="flex justify-center">
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${badge.tone}`}
                                >
                                  {badge.label}
                                </span>
                              </div>
                              <div role="cell" className="flex items-center justify-end gap-1.5">
                                {canJoinAsHost && (
                                  <button
                                    onClick={() => joinAsHost(iv)}
                                    disabled={joiningId === iv.id}
                                    title="Join as host"
                                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-success px-2.5 text-xs font-semibold text-success-foreground hover:opacity-90 disabled:opacity-50"
                                  >
                                    <Video className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                {iv.provider === "external_link" && iv.meeting_url && (
                                  <a
                                    href={iv.meeting_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-semibold hover:bg-surface"
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" /> Link
                                  </a>
                                )}
                                {isActionable(iv.status) && (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <button
                                        type="button"
                                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border hover:bg-surface"
                                        aria-label="Actions"
                                      >
                                        <MoreVertical className="h-3.5 w-3.5" />
                                      </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem onClick={() => setRescheduling(iv)}>
                                        Reschedule
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() => setCancelling(iv)}
                                        className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                                      >
                                        Cancel
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {rescheduling && cid && (
        <RescheduleInterviewModal
          open
          onOpenChange={(v) => !v && setRescheduling(null)}
          companyId={cid}
          interviewId={rescheduling.id}
          currentDurationMin={rescheduling.duration_min}
          onRescheduled={() => {
            setRescheduling(null);
            refetch();
          }}
        />
      )}

      <AlertDialog open={!!cancelling} onOpenChange={(o) => !o && setCancelling(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this interview?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelling?.candidateName || "The candidate"} will be notified. This can't be undone
              — you'll need to schedule a new interview if you change your mind.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelBusy}>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={confirmCancel} disabled={cancelBusy}>
              {cancelBusy ? "Cancelling…" : "Cancel interview"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </EmployerShell>
  );
}
