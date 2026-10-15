import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarClock,
  ExternalLink,
  PhoneCall,
  RefreshCw,
  Search,
  Sparkles,
  UserPlus,
  Users,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { EmployerShell } from "@/components/employer/EmployerShell";
import { CallLogDrawer } from "@/components/employer/CallLogDrawer";
import { ApplicantStatusMenu } from "@/components/employer/ApplicantStatusMenu";
import { LeadStatusMenu } from "@/components/employer/LeadStatusMenu";
import {
  ApplicantReviewPanel,
  type ReviewApplicant,
} from "@/components/employer/ApplicantReviewPanel";
import { ScheduleInterviewModal } from "@/components/employer/ScheduleInterviewModal";
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
import { ThemedListDropdown } from "@/components/ui/themed-form-controls";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyCompanies, getActiveCompanyId } from "@/lib/employer";
import {
  CALL_OUTCOMES,
  getLeads,
  getNextBestActions,
  getOutcomeBadgeClass,
  getTaskCounts,
  mapCrmError,
  moveStage,
  updateLeadStatus,
  type ApplicationStatus,
} from "@/lib/crm.functions";
import { applicantStatusLabel } from "@/lib/applicantStatus";
import { leadStatusLabel } from "@/lib/leadStatus";

export const Route = createFileRoute("/_authenticated/employer/crm")({
  head: () => ({ meta: [{ title: "CRM · JobsKart Employer" }] }),
  component: CrmHubPage,
});

type Lead = {
  candidate_id: string;
  application_id: string | null;
  source: string;
  stage: string;
  job_id: string | null;
  job_title: string | null;
  full_name: string | null;
  city: string | null;
  avatar_url: string | null;
  headline: string | null;
  applied_at: string | null;
  unlocked_at: string | null;
  contacted: boolean;
  last_call_at: string | null;
  last_outcome: string | null;
  open_tasks: number;
  next_follow_up_at: string | null;
  total_count: number;
};

type BestAction = {
  kind: string;
  score: number;
  reason: string;
  application_id: string | null;
  candidate_id: string;
  job_id: string | null;
  link: string;
};

const PAGE_SIZE = 25;

function stageLabel(stage: string) {
  return stage === "new" ? "New lead" : applicantStatusLabel(stage);
}

function SourceBadge({ source }: { source: string }) {
  if (source === "both") {
    return (
      <span className="rounded-full bg-primary-light px-2 py-0.5 text-[10px] font-bold text-primary">
        Applied + Unlocked
      </span>
    );
  }
  if (source === "unlock") {
    return (
      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
        Unlocked
      </span>
    );
  }
  return (
    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-600">
      Applicant
    </span>
  );
}

function CrmHubPage() {
  const [cid, setCid] = useState<string | null>(null);
  const [jobs, setJobs] = useState<{ id: string; title: string }[]>([]);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);

  const [jobFilter, setJobFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [contactedFilter, setContactedFilter] = useState("");

  const [counts, setCounts] = useState({ overdue: 0, dueToday: 0 });
  const [uncontacted, setUncontacted] = useState(0);
  const [hiresWeek, setHiresWeek] = useState(0);

  // Suggested Actions state
  const [bestActions, setBestActions] = useState<BestAction[]>([]);
  const [loadingActions, setLoadingActions] = useState(false);

  const [calling, setCalling] = useState<Lead | null>(null);
  const [updatingLeadId, setUpdatingLeadId] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<{
    lead: Lead;
    status: ApplicationStatus;
  } | null>(null);
  const [pendingBusy, setPendingBusy] = useState(false);
  const [scheduling, setScheduling] = useState<{
    applicationId: string;
    candidateName: string | null;
  } | null>(null);
  const [reviewing, setReviewing] = useState<ReviewApplicant | null>(null);
  const [reviewingLead, setReviewingLead] = useState<Lead | null>(null);
  const [reviewingHasApplication, setReviewingHasApplication] = useState(false);

  const fetchLeads = useServerFn(getLeads);
  const fetchTaskCounts = useServerFn(getTaskCounts);
  const fetchNextBestActions = useServerFn(getNextBestActions);
  const move = useServerFn(moveStage);
  const updateLeadStatusFn = useServerFn(updateLeadStatus);

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

  const loadLeads = async (from = 0) => {
    if (!cid) return;
    setLoading(true);
    try {
      const rows = (await fetchLeads({
        data: {
          companyId: cid,
          jobId: jobFilter || undefined,
          source: (sourceFilter || undefined) as Lead["source"] | undefined,
          stage: stageFilter || undefined,
          contacted: contactedFilter === "" ? undefined : contactedFilter === "yes",
          limit: PAGE_SIZE,
          offset: from,
        },
      })) as Lead[];
      setLeads(rows);
      setOffset(from);
      setTotal(rows[0]?.total_count ?? 0);
    } catch (e) {
      toast.error(mapCrmError(e instanceof Error ? e.message : "Couldn't load leads"));
    } finally {
      setLoading(false);
    }
  };

  const loadKpis = async () => {
    if (!cid) return;
    try {
      const c = await fetchTaskCounts({ data: { companyId: cid } });
      setCounts(c);
      const un = (await fetchLeads({
        data: { companyId: cid, contacted: false, limit: 1 },
      })) as Lead[];
      setUncontacted(un[0]?.total_count ?? 0);

      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - 7);
      const { count } = await supabase
        .from("application_status_history")
        .select("id, applications!inner (company_id)", { count: "exact", head: true })
        .eq("applications.company_id", cid)
        .eq("to_status", "hired")
        .gte("created_at", weekStart.toISOString());
      setHiresWeek(count ?? 0);
    } catch {
      // KPIs are best-effort; silent failure
    }
  };

  const loadActions = async () => {
    if (!cid) return;
    setLoadingActions(true);
    try {
      const res = await fetchNextBestActions({ data: { companyId: cid, limit: 5 } });
      setBestActions((res as BestAction[]) || []);
    } catch {
      // Best-effort
    } finally {
      setLoadingActions(false);
    }
  };

  useEffect(() => {
    if (cid) {
      loadLeads(0);
      loadKpis();
      loadActions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, jobFilter, sourceFilter, stageFilter, contactedFilter]);

  // A lead's status can only change when it has a real application to write
  // it to — get_crm_leads returns a genuine NULL application_id for
  // unlock-only leads, never a fake one, so this mirrors that directly.
  const applyStatusChange = async (lead: Lead, status: ApplicationStatus) => {
    if (!lead.application_id) return;
    setUpdatingLeadId(lead.candidate_id);
    try {
      await move({ data: { applicationIds: [lead.application_id], status } });
      toast.success(`Marked as ${applicantStatusLabel(status)}`);
      loadLeads(offset);
      loadKpis();
      setReviewingLead((prev) =>
        prev && prev.candidate_id === lead.candidate_id ? { ...prev, stage: status } : prev,
      );
      setReviewing((prev) =>
        prev && prev.candidate_id === lead.candidate_id ? { ...prev, status } : prev,
      );
    } catch (e) {
      toast.error(mapCrmError(e instanceof Error ? e.message : "Couldn't update status"));
    } finally {
      setUpdatingLeadId(null);
    }
  };

  const handleStatusChange = (lead: Lead, status: string) => {
    if (!lead.application_id) return;
    if (status === "interview") {
      setScheduling({ applicationId: lead.application_id, candidateName: lead.full_name });
      return;
    }
    if (status === "hired" || status === "rejected") {
      setPendingStatus({ lead, status: status as ApplicationStatus });
      return;
    }
    applyStatusChange(lead, status as ApplicationStatus);
  };

  const confirmPendingStatus = async () => {
    if (!pendingStatus) return;
    setPendingBusy(true);
    await applyStatusChange(pendingStatus.lead, pendingStatus.status);
    setPendingBusy(false);
    setPendingStatus(null);
  };

  // Unlocked leads with no application have nothing in `applications` to
  // write a status to — this updates candidate_unlocks.lead_status instead,
  // a separate record from the application-status workflow above.
  const handleLeadStatusChange = async (lead: Lead, status: string) => {
    if (!cid || lead.application_id) return;
    setUpdatingLeadId(lead.candidate_id);
    try {
      await updateLeadStatusFn({
        data: { companyId: cid, candidateUserId: lead.candidate_id, status: status as never },
      });
      toast.success(`Marked as ${leadStatusLabel(status)}`);
      loadLeads(offset);
    } catch (e) {
      toast.error(mapCrmError(e instanceof Error ? e.message : "Couldn't update lead status"));
    } finally {
      setUpdatingLeadId(null);
    }
  };

  // Opens the shared ApplicantReviewPanel for a CRM lead — same
  // synthetic-then-patched pattern database.tsx's openProfile() already
  // proves works for both application-backed and unlock-only candidates,
  // simplified here since get_crm_leads already gives us the exact
  // application_id (no need to guess the most recent application).
  const openCandidateProfile = (lead: Lead) => {
    setReviewingLead(lead);
    setReviewingHasApplication(false);
    setReviewing({
      id: lead.application_id ?? lead.candidate_id,
      candidate_id: lead.candidate_id,
      status: lead.stage,
      created_at: lead.applied_at ?? lead.unlocked_at ?? new Date().toISOString(),
      cover_note: null,
      expected_salary: null,
      available_from: null,
      profiles: { full_name: lead.full_name, email: null, mobile: null, city: lead.city },
      candidate_profiles: {
        profile_slug: null,
        headline: lead.headline,
        last_role: null,
        skills: null,
        whatsapp_available: false,
      },
    });

    if (cid) {
      supabase
        .rpc("get_unlocked_candidate_contact", {
          _company_id: cid,
          _candidate_user_id: lead.candidate_id,
        })
        .then(({ data }) => {
          const contact = (
            data as Array<{ mobile: string | null; email: string | null }> | null
          )?.[0];
          if (!contact) return;
          setReviewing((prev) =>
            prev && prev.candidate_id === lead.candidate_id
              ? {
                  ...prev,
                  profiles: {
                    ...prev.profiles,
                    mobile: contact.mobile,
                    email: contact.email,
                  } as ReviewApplicant["profiles"],
                  candidate_profiles: {
                    ...prev.candidate_profiles,
                    whatsapp_available: true,
                  } as ReviewApplicant["candidate_profiles"],
                }
              : prev,
          );
        });
    }

    supabase
      .from("candidate_profiles")
      .select("profile_slug, headline, last_role, skills")
      .eq("user_id", lead.candidate_id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        setReviewing((prev) =>
          prev && prev.candidate_id === lead.candidate_id
            ? {
                ...prev,
                candidate_profiles: {
                  ...prev.candidate_profiles,
                  profile_slug: data.profile_slug,
                  headline: data.headline,
                  last_role: data.last_role,
                  skills: data.skills,
                } as ReviewApplicant["candidate_profiles"],
              }
            : prev,
        );
      });

    if (lead.application_id) {
      supabase
        .from("applications")
        .select("id, status, created_at, cover_note, expected_salary, available_from")
        .eq("id", lead.application_id)
        .maybeSingle()
        .then(({ data }) => {
          if (!data) return;
          setReviewingHasApplication(true);
          setReviewing((prev) =>
            prev && prev.candidate_id === lead.candidate_id
              ? {
                  ...prev,
                  id: data.id,
                  status: data.status,
                  created_at: data.created_at,
                  cover_note: data.cover_note,
                  expected_salary: data.expected_salary,
                  available_from: data.available_from,
                }
              : prev,
          );
        });
    }
  };

  const handleReviewStatusChange = (status: string) => {
    if (!reviewingLead || !reviewingHasApplication) {
      toast.info("This candidate hasn't applied to a job at your company yet.");
      return;
    }
    handleStatusChange(reviewingLead, status);
  };

  const kpis = useMemo(
    () => [
      {
        icon: Zap,
        label: "Overdue follow-ups",
        value: counts.overdue,
        colorClass: counts.overdue > 0 ? "text-destructive" : "text-foreground",
      },
      {
        icon: CalendarClock,
        label: "Due today",
        value: counts.dueToday,
        colorClass: "text-amber-600 dark:text-amber-400",
      },
      {
        icon: UserPlus,
        label: "Uncontacted leads",
        value: uncontacted,
        colorClass: "text-primary",
      },
      {
        icon: Users,
        label: "Hires (7 days)",
        value: hiresWeek,
        colorClass: "text-emerald-600 dark:text-emerald-400",
      },
    ],
    [counts, uncontacted, hiresWeek],
  );

  return (
    <EmployerShell
      title="CRM"
      subtitle="Every lead across your jobs — calls, follow-ups and pipeline in one place."
      actions={
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              loadLeads(offset);
              loadKpis();
              loadActions();
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-surface transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      }
    >
      {/* KPI strip */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="rounded-xl border border-border bg-card p-3.5 shadow-[var(--shadow-card)]"
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <k.icon className="h-3.5 w-3.5" /> {k.label}
            </div>
            <p className={`mt-1 text-2xl font-black tabular-nums ${k.colorClass}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Suggested Next-Best Actions */}
      {bestActions.length > 0 && (
        <section className="mb-4 rounded-xl border border-primary/20 bg-primary/5 p-4 shadow-[var(--shadow-card)]">
          <div className="mb-2.5 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
              <Sparkles className="h-4 w-4" /> Next Best Actions
            </h3>
            <span className="text-[11px] font-medium text-muted-foreground">
              High priority queue
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {bestActions.map((act, i) => (
              <div
                key={`${act.candidate_id}-${i}`}
                className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-3 shadow-sm hover:border-primary/40 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary capitalize">
                      {act.kind.replace(/_/g, " ")}
                    </span>
                    <span className="text-[10px] font-bold text-muted-foreground">
                      Score {act.score}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-foreground font-medium">
                    {act.reason}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const leadMatch = leads.find((l) => l.candidate_id === act.candidate_id);
                    if (leadMatch) {
                      setCalling(leadMatch);
                    } else {
                      setCalling({
                        candidate_id: act.candidate_id,
                        application_id: act.application_id,
                        job_id: act.job_id,
                        source: "unlock",
                        stage: "new",
                        job_title: null,
                        full_name: "Candidate",
                        city: null,
                        avatar_url: null,
                        headline: null,
                        applied_at: null,
                        unlocked_at: null,
                        contacted: false,
                        last_call_at: null,
                        last_outcome: null,
                        open_tasks: 0,
                        next_follow_up_at: null,
                        total_count: 0,
                      });
                    }
                  }}
                  className="shrink-0 inline-flex h-7 items-center gap-1 rounded bg-primary px-2 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  <PhoneCall className="h-3 w-3" /> Call
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Filters */}
      <section className="mb-4 grid gap-2 rounded-xl border border-border bg-card p-3 shadow-[var(--shadow-card)] sm:grid-cols-2 lg:grid-cols-4">
        <ThemedListDropdown
          label="Filter by job"
          value={jobFilter}
          onChange={setJobFilter}
          selectedOptionClassName="bg-primary/10 font-medium text-primary hover:bg-primary/15"
          options={[
            { value: "", label: "All jobs" },
            ...jobs.map((j) => ({ value: j.id, label: j.title })),
          ]}
        />
        <ThemedListDropdown
          label="Filter by source"
          value={sourceFilter}
          onChange={setSourceFilter}
          selectedOptionClassName="bg-primary/10 font-medium text-primary hover:bg-primary/15"
          options={[
            { value: "", label: "All sources" },
            { value: "application", label: "Applicants" },
            { value: "unlock", label: "Unlocked" },
            { value: "both", label: "Applied + Unlocked" },
          ]}
        />
        <ThemedListDropdown
          label="Filter by stage"
          value={stageFilter}
          onChange={setStageFilter}
          selectedOptionClassName="bg-primary/10 font-medium text-primary hover:bg-primary/15"
          options={[
            { value: "", label: "All stages" },
            { value: "new", label: "New lead" },
            { value: "applied", label: "Applied" },
            { value: "shortlisted", label: "Shortlisted" },
            { value: "interview", label: "Interview" },
            { value: "hired", label: "Hired" },
            { value: "rejected", label: "Rejected" },
          ]}
        />
        <ThemedListDropdown
          label="Filter by contacted"
          value={contactedFilter}
          onChange={setContactedFilter}
          selectedOptionClassName="bg-primary/10 font-medium text-primary hover:bg-primary/15"
          options={[
            { value: "", label: "Contacted: any" },
            { value: "yes", label: "Contacted" },
            { value: "no", label: "Not contacted" },
          ]}
        />
      </section>

      {/* Leads table */}
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Users className="h-4 w-4 text-primary" /> Leads
            <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-bold tabular-nums text-muted-foreground">
              {total}
            </span>
          </h2>
        </div>
        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-surface" />
            ))}
          </div>
        ) : leads.length === 0 ? (
          <div className="grid place-items-center p-12 text-center">
            <Search className="mb-3 h-7 w-7 text-muted-foreground" />
            <p className="text-sm font-semibold">No leads match these filters</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Leads come from your applicants and unlocked candidates.
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[48rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2.5 font-semibold">Candidate</th>
                    <th className="px-4 py-2.5 font-semibold">Source</th>
                    <th className="px-4 py-2.5 font-semibold">Stage</th>
                    <th className="px-4 py-2.5 font-semibold">Last call</th>
                    <th className="px-4 py-2.5 font-semibold">Next follow-up</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((l) => {
                    const lastOutcome = CALL_OUTCOMES.find((o) => o.id === l.last_outcome);
                    const followUpOverdue =
                      l.next_follow_up_at && new Date(l.next_follow_up_at) < new Date();
                    return (
                      <tr
                        key={l.candidate_id}
                        className="border-b border-border/60 last:border-0 hover:bg-surface/50 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => openCandidateProfile(l)}
                            className="flex items-center gap-2.5 text-left"
                          >
                            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-light text-xs font-bold text-primary">
                              {(l.full_name ?? "?")
                                .split(" ")
                                .slice(0, 2)
                                .map((n) => n[0])
                                .join("")
                                .toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-foreground hover:underline">
                                {l.full_name ?? "Candidate"}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {[l.headline, l.city, l.job_title].filter(Boolean).join(" · ") ||
                                  "—"}
                              </p>
                            </div>
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <SourceBadge source={l.source} />
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded-full bg-surface px-2.5 py-1 text-[11px] font-semibold text-foreground/80">
                            {stageLabel(l.stage)}
                          </span>
                          {l.open_tasks > 0 && (
                            <span className="ml-1.5 rounded-full bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400">
                              {l.open_tasks} task{l.open_tasks === 1 ? "" : "s"}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {l.last_call_at ? (
                            <span className="flex flex-col gap-0.5">
                              <span
                                className={`inline-block w-fit rounded-full px-2 py-0.5 text-[10px] font-bold ${getOutcomeBadgeClass(l.last_outcome ?? "")}`}
                              >
                                {lastOutcome?.label ?? l.last_outcome}
                              </span>
                              <span className="text-muted-foreground">
                                {formatDistanceToNow(new Date(l.last_call_at), { addSuffix: true })}
                              </span>
                            </span>
                          ) : l.contacted ? (
                            <span className="text-muted-foreground">Contacted</span>
                          ) : (
                            <span className="font-semibold text-amber-600 dark:text-amber-400">
                              Not called yet
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {l.next_follow_up_at ? (
                            <span
                              className={`font-semibold ${followUpOverdue ? "text-destructive" : "text-foreground/80"}`}
                            >
                              {formatDistanceToNow(new Date(l.next_follow_up_at), {
                                addSuffix: true,
                              })}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setCalling(l)}
                              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary-dark transition-colors"
                            >
                              <PhoneCall className="h-3.5 w-3.5" /> Log call
                            </button>
                            {l.application_id ? (
                              // Applicant / Applied + Unlocked: the authoritative
                              // application-status workflow, same as /employer/responses.
                              l.stage === "hired" || l.stage === "rejected" ? (
                                // update_application_status() rejects any transition out of a
                                // terminal state (hired/rejected) — disabled up front instead of
                                // letting the recruiter pick an option that will always fail.
                                <span
                                  title={`${applicantStatusLabel(l.stage)} is final and can't be changed here`}
                                  className="inline-flex h-8 cursor-not-allowed items-center rounded-lg border border-border bg-surface px-2.5 text-xs font-semibold text-muted-foreground"
                                >
                                  {applicantStatusLabel(l.stage)}
                                </span>
                              ) : (
                                <ApplicantStatusMenu
                                  value={l.stage}
                                  onChange={(status) => handleStatusChange(l, status)}
                                  className={
                                    updatingLeadId === l.candidate_id
                                      ? "pointer-events-none opacity-60"
                                      : ""
                                  }
                                />
                              )
                            ) : (
                              // Unlocked, no application yet: a separate lead-engagement
                              // status tracked on candidate_unlocks.lead_status, never
                              // written to the applications table.
                              <LeadStatusMenu
                                value={l.stage}
                                onChange={(status) => handleLeadStatusChange(l, status)}
                                className={
                                  updatingLeadId === l.candidate_id
                                    ? "pointer-events-none opacity-60"
                                    : ""
                                }
                              />
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {total > PAGE_SIZE && (
              <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs">
                <span className="text-muted-foreground">
                  Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => loadLeads(Math.max(0, offset - PAGE_SIZE))}
                    disabled={offset === 0 || loading}
                    className="rounded-lg border border-border bg-card px-3 py-1.5 font-semibold hover:bg-surface disabled:opacity-50 transition-colors"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => loadLeads(offset + PAGE_SIZE)}
                    disabled={offset + PAGE_SIZE >= total || loading}
                    className="rounded-lg border border-border bg-card px-3 py-1.5 font-semibold hover:bg-surface disabled:opacity-50 transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {calling && cid && (
        <CallLogDrawer
          open={!!calling}
          onOpenChange={(o) => !o && setCalling(null)}
          companyId={cid}
          candidateId={calling.candidate_id}
          candidateName={calling.full_name}
          applicationId={calling.application_id}
          jobId={calling.job_id}
          source={calling.source}
          onLogged={() => {
            loadLeads(offset);
            loadKpis();
            loadActions();
          }}
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
            loadLeads(offset);
            loadKpis();
          }}
        />
      )}

      <AlertDialog
        open={!!pendingStatus}
        onOpenChange={(o) => {
          if (!o) setPendingStatus(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Move {pendingStatus?.lead.full_name || "this candidate"} to{" "}
              {pendingStatus ? applicantStatusLabel(pendingStatus.status) : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This updates the candidate's application status right away. You can change it again
              later if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendingBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPendingStatus} disabled={pendingBusy}>
              {pendingBusy ? "Updating…" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {reviewing && cid && (
        <ApplicantReviewPanel
          applicant={reviewing}
          onClose={() => {
            setReviewing(null);
            setReviewingLead(null);
          }}
          onStatusChange={handleReviewStatusChange}
          companyId={cid}
          jobId={reviewingLead?.job_id ?? null}
        />
      )}
    </EmployerShell>
  );
}
