import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
  Search,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { EmployerShell } from "@/components/employer/EmployerShell";
import { AddTaskDialog } from "@/components/employer/AddTaskDialog";
import { CallLogDrawer } from "@/components/employer/CallLogDrawer";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyCompanies, getActiveCompanyId } from "@/lib/employer";
import { getTasks, mapCrmError, saveTask, setTaskStatus } from "@/lib/crm.functions";

export const Route = createFileRoute("/_authenticated/employer/crm_/follow-ups")({
  head: () => ({ meta: [{ title: "Follow-up Calendar · JobsKart Employer" }] }),
  component: FollowUpCalendarPage,
});

type Task = {
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
  task_type: string;
  profiles: { full_name: string | null; avatar_url: string | null } | null;
};

const TASK_TYPE_LABEL: Record<string, string> = {
  call: "Call",
  interview_followup: "Interview Follow-up",
  send_message: "Send Message",
  check_application: "Check Application",
  other: "Other",
};

const STATUS_FILTERS = ["all", "due_today", "upcoming", "overdue", "completed"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  all: "All Follow-ups",
  due_today: "Due Today",
  upcoming: "Upcoming",
  overdue: "Overdue",
  completed: "Completed",
};

function FollowUpCalendarPage() {
  const [cid, setCid] = useState<string | null>(null);
  const [month, setMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [addingTask, setAddingTask] = useState(false);
  const [calling, setCalling] = useState<Task | null>(null);
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [rescheduleValue, setRescheduleValue] = useState("");
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  const fetchTasks = useServerFn(getTasks);
  const updateTaskStatus = useServerFn(setTaskStatus);
  const saveTaskFn = useServerFn(saveTask);

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
      setCid(id);
    })();
  }, []);

  const gridStart = useMemo(() => startOfWeek(startOfMonth(month)), [month]);
  const gridEnd = useMemo(() => endOfWeek(endOfMonth(month)), [month]);
  const gridDays = useMemo(
    () => eachDayOfInterval({ start: gridStart, end: gridEnd }),
    [gridStart, gridEnd],
  );

  const loadTasks = async () => {
    if (!cid) return;
    setLoading(true);
    try {
      const rows = await fetchTasks({
        data: {
          companyId: cid,
          from: gridStart.toISOString(),
          to: gridEnd.toISOString(),
          status: "all",
        },
      });
      setTasks(rows as unknown as Task[]);
    } catch (e) {
      toast.error(mapCrmError(e instanceof Error ? e.message : "Couldn't load follow-ups"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (cid) loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, month]);

  const now = new Date();
  const matchesStatusFilter = (t: Task) => {
    if (statusFilter === "all") return true;
    if (statusFilter === "completed") return t.status === "done";
    if (t.status !== "open") return false;
    const due = new Date(t.due_at);
    if (statusFilter === "overdue") return due < now;
    if (statusFilter === "due_today") return isSameDay(due, now);
    if (statusFilter === "upcoming") return due > now && !isSameDay(due, now);
    return true;
  };

  const filteredTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          matchesStatusFilter(t) &&
          (!search.trim() || t.title.toLowerCase().includes(search.trim().toLowerCase())),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, statusFilter, search],
  );

  const tasksByDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of filteredTasks) {
      const key = format(new Date(t.due_at), "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return map;
  }, [filteredTasks]);

  const selectedKey = format(selectedDate, "yyyy-MM-dd");
  const selectedTasks = (tasksByDay.get(selectedKey) ?? []).sort(
    (a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime(),
  );

  const handleComplete = async (taskId: string) => {
    setBusyTaskId(taskId);
    try {
      await updateTaskStatus({ data: { taskId, status: "done" } });
      toast.success("Marked complete");
      loadTasks();
    } catch (e) {
      toast.error(mapCrmError(e instanceof Error ? e.message : "Couldn't complete task"));
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleCancel = async (taskId: string) => {
    setBusyTaskId(taskId);
    try {
      await updateTaskStatus({ data: { taskId, status: "cancelled" } });
      toast.success("Follow-up cancelled");
      loadTasks();
    } catch (e) {
      toast.error(mapCrmError(e instanceof Error ? e.message : "Couldn't cancel task"));
    } finally {
      setBusyTaskId(null);
    }
  };

  const startReschedule = (t: Task) => {
    const d = new Date(t.due_at);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    setRescheduleValue(d.toISOString().slice(0, 16));
    setReschedulingId(t.id);
  };

  const confirmReschedule = async (t: Task) => {
    if (!cid || !rescheduleValue) return;
    setBusyTaskId(t.id);
    try {
      // crm_save_task updates the existing row when taskId is supplied — this
      // never creates a duplicate follow-up, it just moves the same one.
      await saveTaskFn({
        data: {
          companyId: cid,
          candidateId: t.candidate_id,
          taskId: t.id,
          title: t.title,
          dueAt: new Date(rescheduleValue).toISOString(),
          applicationId: t.application_id ?? undefined,
          jobId: t.job_id ?? undefined,
          body: t.body ?? undefined,
          priority: t.priority,
          taskType: t.task_type as never,
        },
      });
      toast.success("Follow-up rescheduled");
      setReschedulingId(null);
      loadTasks();
    } catch (e) {
      toast.error(mapCrmError(e instanceof Error ? e.message : "Couldn't reschedule"));
    } finally {
      setBusyTaskId(null);
    }
  };

  return (
    <EmployerShell
      title="Follow-up Calendar"
      subtitle="Every scheduled follow-up across your leads, by date."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/employer/crm"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-surface transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> CRM
          </Link>
          <Link
            to="/employer/crm/automation"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-surface transition-colors"
          >
            <Zap className="h-3.5 w-3.5 text-primary" /> Automation rules
          </Link>
          <button
            type="button"
            onClick={() => setAddingTask(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary-dark transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> Add Follow-up
          </button>
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <section className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="text-base font-bold">{format(month, "MMMM yyyy")}</h2>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setMonth((m) => addMonths(m, -1))}
                className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card hover:bg-surface"
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setMonth(new Date());
                  setSelectedDate(new Date());
                }}
                className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold hover:bg-surface"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => setMonth((m) => addMonths(m, 1))}
                className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card hover:bg-surface"
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="mb-3 flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setStatusFilter(f)}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                  statusFilter === f
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-card text-muted-foreground hover:bg-surface"
                }`}
              >
                {STATUS_FILTER_LABEL[f]}
              </button>
            ))}
          </div>

          <div className="relative mb-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by follow-up title…"
              className="form-input h-9 w-full pl-9 text-sm"
            />
          </div>

          {loading ? (
            <div className="grid grid-cols-7 gap-1.5">
              {Array.from({ length: 35 }).map((_, i) => (
                <div key={i} className="h-20 animate-pulse rounded-lg bg-surface" />
              ))}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase text-muted-foreground">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <div key={d} className="py-1">
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {gridDays.map((day) => {
                  const key = format(day, "yyyy-MM-dd");
                  const dayTasks = tasksByDay.get(key) ?? [];
                  const openTasks = dayTasks.filter((t) => t.status === "open");
                  const overdueCount = openTasks.filter((t) => new Date(t.due_at) < now).length;
                  const selected = isSameDay(day, selectedDate);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelectedDate(day)}
                      className={`flex min-h-20 flex-col items-start gap-1 rounded-lg border p-1.5 text-left transition-colors ${
                        selected
                          ? "border-primary bg-primary/10"
                          : "border-border bg-card hover:bg-surface"
                      } ${!isSameMonth(day, month) ? "opacity-40" : ""}`}
                    >
                      <span
                        className={`text-xs font-semibold ${isToday(day) ? "text-primary" : "text-foreground"}`}
                      >
                        {format(day, "d")}
                      </span>
                      {dayTasks.length > 0 && (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                            overdueCount > 0
                              ? "bg-destructive-light text-destructive"
                              : "bg-primary-light text-primary"
                          }`}
                        >
                          {dayTasks.length} {dayTasks.length === 1 ? "follow-up" : "follow-ups"}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold">
            <CalendarClock className="h-4 w-4 text-primary" />
            {format(selectedDate, "EEEE, d MMM")}
          </h2>

          {selectedTasks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-6 text-center">
              <p className="text-sm font-semibold text-foreground">No follow-ups on this date</p>
              <button
                type="button"
                onClick={() => setAddingTask(true)}
                className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary-dark"
              >
                <Plus className="h-3.5 w-3.5" /> Add Follow-up
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {selectedTasks.map((t) => {
                const busy = busyTaskId === t.id;
                const overdue = t.status === "open" && new Date(t.due_at) < now;
                return (
                  <div key={t.id} className="rounded-lg border border-border bg-surface/50 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {t.profiles?.full_name ?? "Candidate"}
                        </p>
                        <p className="truncate text-xs text-foreground/80">{t.title}</p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          t.status === "done"
                            ? "bg-success-light text-success"
                            : t.status === "cancelled"
                              ? "bg-surface text-muted-foreground"
                              : overdue
                                ? "bg-destructive-light text-destructive"
                                : "bg-primary-light text-primary"
                        }`}
                      >
                        {t.status === "done"
                          ? "Completed"
                          : t.status === "cancelled"
                            ? "Cancelled"
                            : overdue
                              ? "Overdue"
                              : "Pending"}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="rounded bg-surface px-1.5 py-0.5 font-semibold">
                        {TASK_TYPE_LABEL[t.task_type] ?? t.task_type}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {format(new Date(t.due_at), "h:mm a")}
                      </span>
                    </div>

                    {reschedulingId === t.id ? (
                      <div className="mt-2 flex items-center gap-1.5">
                        <input
                          type="datetime-local"
                          value={rescheduleValue}
                          onChange={(e) => setRescheduleValue(e.target.value)}
                          className="form-input h-8 flex-1 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => confirmReschedule(t)}
                          disabled={busy}
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground hover:bg-primary-dark disabled:opacity-50"
                          aria-label="Save new time"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setReschedulingId(null)}
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border hover:bg-surface"
                          aria-label="Cancel reschedule"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setCalling(t)}
                          className="inline-flex h-7 items-center gap-1 rounded border border-border bg-card px-2 text-[11px] font-semibold hover:bg-surface"
                        >
                          Log call
                        </button>
                        {t.status === "open" && (
                          <>
                            <button
                              type="button"
                              onClick={() => startReschedule(t)}
                              disabled={busy}
                              className="inline-flex h-7 items-center gap-1 rounded border border-border bg-card px-2 text-[11px] font-semibold hover:bg-surface disabled:opacity-50"
                            >
                              Reschedule
                            </button>
                            <button
                              type="button"
                              onClick={() => handleComplete(t.id)}
                              disabled={busy}
                              className="inline-flex h-7 items-center gap-1 rounded bg-emerald-600 px-2 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              <Check className="h-3 w-3" /> Complete
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCancel(t.id)}
                              disabled={busy}
                              className="inline-flex h-7 items-center gap-1 rounded border border-destructive/30 bg-destructive/5 px-2 text-[11px] font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"
                            >
                              <X className="h-3 w-3" /> Cancel
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {cid && (
        <AddTaskDialog
          open={addingTask}
          onOpenChange={setAddingTask}
          companyId={cid}
          initialDueDate={selectedDate}
          onSaved={loadTasks}
        />
      )}

      {calling && cid && (
        <CallLogDrawer
          open={!!calling}
          onOpenChange={(o) => !o && setCalling(null)}
          companyId={cid}
          candidateId={calling.candidate_id}
          candidateName={calling.profiles?.full_name ?? null}
          applicationId={calling.application_id}
          jobId={calling.job_id}
          onLogged={loadTasks}
        />
      )}
    </EmployerShell>
  );
}
