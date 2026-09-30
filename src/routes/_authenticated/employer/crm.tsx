import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  ExternalLink,
  ListTodo,
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
import { ThemedSelect } from "@/components/ui/themed-form-controls";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyCompanies, getActiveCompanyId } from "@/lib/employer";
import {
  CALL_OUTCOMES,
  getLeads,
  getNextBestActions,
  getOutcomeBadgeClass,
  getTaskCounts,
  getTasks,
  mapCrmError,
  setTaskStatus,
} from "@/lib/crm.functions";
import { applicantStatusLabel } from "@/lib/applicantStatus";

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

type TaskItem = {
  id: string;
  title: string;
  body: string | null;
  priority: number;
  due_at: string;
  status: "open" | "done" | "snoozed" | "cancelled";
  source: string;
  application_id: string | null;
  job_id: string | null;
  candidate_id: string;
  assignee_id: string | null;
  profiles: { full_name: string | null; avatar_url: string | null } | null;
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

  // Follow-up tasks panel state
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [taskFilter, setTaskFilter] = useState<"due" | "overdue" | "all">("due");
  const [loadingTasks, setLoadingTasks] = useState(false);

  const [calling, setCalling] = useState<Lead | null>(null);

  const fetchLeads = useServerFn(getLeads);
  const fetchTaskCounts = useServerFn(getTaskCounts);
  const fetchTasks = useServerFn(getTasks);
  const updateTaskStatus = useServerFn(setTaskStatus);
  const fetchNextBestActions = useServerFn(getNextBestActions);

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

  const loadTasksList = async () => {
    if (!cid) return;
    setLoadingTasks(true);
    try {
      const res = await fetchTasks({ data: { companyId: cid, view: taskFilter } });
      setTasks((res as TaskItem[]) || []);
    } catch (e) {
      // ignore silently or show toast
    } finally {
      setLoadingTasks(false);
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
      loadTasksList();
      loadActions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, jobFilter, sourceFilter, stageFilter, contactedFilter]);

  useEffect(() => {
    if (cid) {
      loadTasksList();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, taskFilter]);

  const handleCompleteTask = async (taskId: string) => {
    try {
      await updateTaskStatus({ data: { taskId, status: "done" } });
      toast.success("Task completed");
      loadTasksList();
      loadKpis();
    } catch (e) {
      toast.error(mapCrmError(e instanceof Error ? e.message : "Couldn't complete task"));
    }
  };

  const handleSnoozeTask = async (taskId: string) => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    try {
      await updateTaskStatus({ data: { taskId, status: "snoozed", newDueAt: tomorrow } });
      toast.success("Task snoozed by 24h");
      loadTasksList();
      loadKpis();
    } catch (e) {
      toast.error(mapCrmError(e instanceof Error ? e.message : "Couldn't snooze task"));
    }
  };

  const kpis = useMemo(
    () => [
      {
        icon: Zap,
        label: "Overdue follow-ups",
        value: counts.overdue,
        colorClass: counts.overdue > 0 ? "text-destructive" : "text-foreground",
      },
      { icon: CalendarClock, label: "Due today", value: counts.dueToday, colorClass: "text-amber-600 dark:text-amber-400" },
      { icon: UserPlus, label: "Uncontacted leads", value: uncontacted, colorClass: "text-primary" },
      { icon: Users, label: "Hires (7 days)", value: hiresWeek, colorClass: "text-emerald-600 dark:text-emerald-400" },
    ],
    [counts, uncontacted, hiresWeek],
  );

  return (
    <EmployerShell
      title="CRM"
      subtitle="Every lead across your jobs — calls, follow-ups and pipeline in one place."
      actions={
        <div className="flex flex-wrap gap-2">
          <Link
            to="/employer/crm/automation"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-surface transition-colors"
          >
            <Zap className="h-3.5 w-3.5 text-primary" /> Automation
          </Link>
          <button
            type="button"
            onClick={() => {
              loadLeads(offset);
              loadKpis();
              loadTasksList();
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
            <span className="text-[11px] font-medium text-muted-foreground">High priority queue</span>
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
                    <span className="text-[10px] font-bold text-muted-foreground">Score {act.score}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-foreground font-medium">{act.reason}</p>
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

      {/* Follow-up Tasks Section */}
      <section className="mb-4 rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <ListTodo className="h-4 w-4 text-primary" /> Follow-Up Tasks
            <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-bold tabular-nums text-muted-foreground">
              {tasks.length}
            </span>
          </h2>
          <div className="flex gap-1.5">
            {(["due", "overdue", "all"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setTaskFilter(v)}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold capitalize transition-colors ${
                  taskFilter === v
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-card text-muted-foreground hover:bg-surface"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {loadingTasks ? (
          <div className="space-y-2 py-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-surface" />
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No {taskFilter} tasks found.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {tasks.map((t) => {
              const isOverdue = new Date(t.due_at) < new Date();
              return (
                <div
                  key={t.id}
                  className="flex flex-col justify-between rounded-lg border border-border bg-surface/50 p-3"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-bold text-foreground">
                        {t.profiles?.full_name ?? "Candidate"}
                      </span>
                      <span
                        className={`text-[10px] font-semibold ${
                          isOverdue ? "text-destructive" : "text-muted-foreground"
                        }`}
                      >
                        {formatDistanceToNow(new Date(t.due_at), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-foreground/90 font-medium">{t.title}</p>
                    {t.body && <p className="mt-0.5 text-[11px] text-muted-foreground">{t.body}</p>}
                  </div>
                  <div className="mt-3 flex items-center justify-end gap-1.5 pt-2 border-t border-border/50">
                    <button
                      type="button"
                      onClick={() => handleSnoozeTask(t.id)}
                      className="inline-flex h-7 items-center gap-1 rounded border border-border bg-card px-2 text-[11px] font-semibold text-muted-foreground hover:bg-surface"
                    >
                      <Clock className="h-3 w-3" /> Snooze 24h
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCompleteTask(t.id)}
                      className="inline-flex h-7 items-center gap-1 rounded bg-emerald-600 px-2 text-[11px] font-semibold text-white hover:bg-emerald-700"
                    >
                      <CheckCircle2 className="h-3 w-3" /> Done
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Filters */}
      <section className="mb-4 grid gap-2 rounded-xl border border-border bg-card p-3 shadow-[var(--shadow-card)] sm:grid-cols-2 lg:grid-cols-4">
        <ThemedSelect
          value={jobFilter}
          onChange={(e) => setJobFilter(e.target.value)}
          aria-label="Filter by job"
        >
          <option value="">All jobs</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.title}
            </option>
          ))}
        </ThemedSelect>
        <ThemedSelect
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          aria-label="Filter by source"
        >
          <option value="">All sources</option>
          <option value="application">Applicants</option>
          <option value="unlock">Unlocked</option>
          <option value="both">Applied + Unlocked</option>
        </ThemedSelect>
        <ThemedSelect
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          aria-label="Filter by stage"
        >
          <option value="">All stages</option>
          <option value="new">New lead</option>
          <option value="applied">Applied</option>
          <option value="shortlisted">Shortlisted</option>
          <option value="interview">Interview</option>
          <option value="hired">Hired</option>
          <option value="rejected">Rejected</option>
        </ThemedSelect>
        <ThemedSelect
          value={contactedFilter}
          onChange={(e) => setContactedFilter(e.target.value)}
          aria-label="Filter by contacted"
        >
          <option value="">Contacted: any</option>
          <option value="yes">Contacted</option>
          <option value="no">Not contacted</option>
        </ThemedSelect>
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
                      <tr key={l.candidate_id} className="border-b border-border/60 last:border-0 hover:bg-surface/50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-light text-xs font-bold text-primary">
                              {(l.full_name ?? "?").split(" ").slice(0, 2).map((n) => n[0]).join("").toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-foreground">
                                {l.full_name ?? "Candidate"}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {[l.headline, l.city, l.job_title].filter(Boolean).join(" · ") || "—"}
                              </p>
                            </div>
                          </div>
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
                              <span className={`inline-block w-fit rounded-full px-2 py-0.5 text-[10px] font-bold ${getOutcomeBadgeClass(l.last_outcome ?? "")}`}>
                                {lastOutcome?.label ?? l.last_outcome}
                              </span>
                              <span className="text-muted-foreground">
                                {formatDistanceToNow(new Date(l.last_call_at), { addSuffix: true })}
                              </span>
                            </span>
                          ) : l.contacted ? (
                            <span className="text-muted-foreground">Contacted</span>
                          ) : (
                            <span className="font-semibold text-amber-600 dark:text-amber-400">Not called yet</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {l.next_follow_up_at ? (
                            <span
                              className={`font-semibold ${followUpOverdue ? "text-destructive" : "text-foreground/80"}`}
                            >
                              {formatDistanceToNow(new Date(l.next_follow_up_at), { addSuffix: true })}
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
                            {l.job_id && l.application_id && (
                              <Link
                                to="/employer/jobs/$jobId/applicants"
                                params={{ jobId: l.job_id }}
                                className="inline-flex h-8 items-center rounded-lg border border-border bg-card px-2.5 text-xs font-semibold hover:bg-surface transition-colors"
                              >
                                Pipeline
                              </Link>
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
            loadTasksList();
            loadActions();
          }}
        />
      )}
    </EmployerShell>
  );
}

