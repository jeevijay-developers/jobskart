import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  Bookmark,
  BookmarkCheck,
  ChevronDown,
  EyeOff,
  Loader2,
  Lock,
  MessageSquareText,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { CandidateShell } from "@/components/candidate/CandidateShell";
import { supabase } from "@/integrations/supabase/client";
import {
  BAND_LABELS,
  CATEGORY_LABELS,
  type Band,
  type Framework,
  type Progress,
} from "@/lib/interview-prep";
import {
  deletePrepHistory,
  getPrepProgress,
  setQuestionPref,
  startPrepSession,
  type StartPrepInput,
} from "@/lib/interview-prep.functions";

export const Route = createFileRoute("/_authenticated/candidate/interview-prep/")({
  head: () => ({ meta: [{ title: "Interview Prep · JobsKart" }] }),
  component: InterviewPrepHome,
});

type UpcomingInterview = {
  id: string;
  scheduled_at: string;
  mode: string;
  jobs: { title: string } | null;
};
type SessionRow = {
  id: string;
  role_title: string;
  context_type: string;
  status: string;
  started_at: string;
};
type Template = {
  id: string;
  category: string;
  question: string;
  difficulty: string;
  framework: Framework;
};

function InterviewPrepHome() {
  const navigate = useNavigate();
  const start = useServerFn(startPrepSession);
  const removeHistory = useServerFn(deletePrepHistory);
  const fetchProgress = useServerFn(getPrepProgress);
  const savePref = useServerFn(setQuestionPref);

  const [interviews, setInterviews] = useState<UpcomingInterview[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [category, setCategory] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Record<string, "saved" | "hidden">>({});
  const [showHidden, setShowHidden] = useState(false);
  const [progress, setProgress] = useState<{
    progress: Progress;
    lastRoleTitle: string | null;
  } | null>(null);

  const db = supabase;

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const [iv, ses, tpl, pf] = await Promise.all([
      db
        .from("interviews")
        .select("id, scheduled_at, mode, jobs (title)")
        .in("status", ["scheduled", "confirmed", "rescheduled"])
        .gte("scheduled_at", since)
        .order("scheduled_at")
        .limit(5),
      db
        .from("interview_prep_sessions")
        .select("id, role_title, context_type, status, started_at")
        .order("started_at", { ascending: false })
        .limit(20),
      db
        .from("interview_prep_question_templates")
        .select("id, category, question, difficulty, framework")
        .order("category"),
      db.from("interview_prep_question_prefs").select("template_id, pref"),
    ]);
    const map: Record<string, "saved" | "hidden"> = {};
    for (const r of (pf.data ?? []) as Array<{ template_id: string; pref: "saved" | "hidden" }>)
      map[r.template_id] = r.pref;
    setPrefs(map);
    setInterviews((iv.data ?? []) as UpcomingInterview[]);
    setSessions((ses.data ?? []) as SessionRow[]);
    setTemplates((tpl.data ?? []) as Template[]);
    setLoading(false);
    // Progress is a nice-to-have; never block the page on it.
    fetchProgress()
      .then(setProgress)
      .catch(() => setProgress(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const begin = async (key: string, data: StartPrepInput) => {
    setBusy(key);
    try {
      const { sessionId } = await start({ data });
      void navigate({ to: "/candidate/interview-prep/$sessionId", params: { sessionId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start practice.");
      setBusy(null);
    }
  };

  const setPref = async (templateId: string, pref: "saved" | "hidden" | null) => {
    const before = prefs;
    setPrefs((cur) => {
      const next = { ...cur };
      if (pref) next[templateId] = pref;
      else delete next[templateId];
      return next;
    });
    try {
      await savePref({ data: { templateId, pref } });
    } catch (e) {
      setPrefs(before);
      toast.error(e instanceof Error ? e.message : "Could not save.");
    }
  };

  const clearAll = async () => {
    if (
      !window.confirm(
        "Delete all your practice sessions, answers and feedback? This can't be undone.",
      )
    )
      return;
    try {
      await removeHistory({ data: {} });
      setSessions([]);
      setProgress(null);
      toast.success("Practice history deleted.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete.");
    }
  };

  const categories = useMemo(
    () => Array.from(new Set(templates.map((t) => t.category))),
    [templates],
  );
  const hiddenCount = templates.filter((t) => prefs[t.id] === "hidden").length;
  const shown = templates.filter((t) => {
    if (category === "saved") return prefs[t.id] === "saved";
    if (category !== "all" && t.category !== category) return false;
    return showHidden || prefs[t.id] !== "hidden";
  });

  return (
    <CandidateShell
      title="Interview prep"
      subtitle="Practise answers for a real interview or any role — private, with tips you can act on."
    >
      <p className="mb-6 flex items-start gap-2 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <span>
          Your practice is private. Employers never see your answers, feedback or readiness, and it
          doesn't affect your applications. Feedback is AI coaching and may be imperfect — it does
          not predict whether you'll be hired.
        </span>
      </p>

      {loading ? (
        <div className="grid place-items-center rounded-xl border border-border bg-card p-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-8">
          {interviews.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-foreground">
                Your upcoming interviews
              </h2>
              <div className="grid gap-3">
                {interviews.map((iv) => (
                  <div
                    key={iv.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
                  >
                    <div>
                      <p className="font-semibold text-foreground">
                        {iv.jobs?.title ?? "Interview"}
                      </p>
                      <p className="text-xs capitalize text-muted-foreground">
                        {format(new Date(iv.scheduled_at), "eee, dd MMM · h:mm a")} · {iv.mode}
                      </p>
                    </div>
                    <button
                      disabled={!!busy}
                      onClick={() =>
                        begin(iv.id, {
                          contextType: "interview",
                          interviewId: iv.id,
                          questionCount: 6,
                        })
                      }
                      className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                    >
                      {busy === iv.id && <Loader2 className="h-4 w-4 animate-spin" />}
                      Prepare for this interview
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-lg font-semibold text-foreground">Practise for a role</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter the job you're aiming for, e.g. “Delivery executive” or “Customer support”.
            </p>
            <form
              className="mt-3 flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (role.trim().length >= 2)
                  void begin("role", {
                    contextType: "role",
                    roleTitle: role.trim(),
                    questionCount: 6,
                  });
              }}
            >
              <input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                maxLength={80}
                placeholder="Role or job title"
                aria-label="Role or job title"
                className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm"
              />
              <button
                type="submit"
                disabled={!!busy || role.trim().length < 2}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {busy === "role" && <Loader2 className="h-4 w-4 animate-spin" />}
                Start 6-question practice
              </button>
            </form>
            <p className="mt-2 text-xs text-muted-foreground">
              Practising for a specific job?{" "}
              <Link to="/candidate/applications" className="font-semibold text-primary">
                Open your applications
              </Link>{" "}
              to prepare for a scheduled interview.
            </p>
          </section>

          {progress && progress.progress.answered > 0 && (
            <ProgressSection
              data={progress}
              busy={busy === "weak"}
              onPractise={() =>
                begin("weak", {
                  contextType: "role",
                  roleTitle: progress.lastRoleTitle ?? "General practice",
                  questionCount: 4,
                  categories: progress.progress.weakest as never,
                })
              }
            />
          )}

          {sessions.length > 0 && (
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">Your practice history</h2>
                <button
                  onClick={clearAll}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete all
                </button>
              </div>
              <div className="grid gap-2">
                {sessions.map((s) => (
                  <Link
                    key={s.id}
                    to="/candidate/interview-prep/$sessionId"
                    params={{ sessionId: s.id }}
                    className="flex items-center justify-between rounded-xl border border-border bg-card p-3 hover:bg-surface"
                  >
                    <span className="text-sm font-semibold text-foreground">{s.role_title}</span>
                    <span className="text-xs text-muted-foreground">
                      {s.status === "completed" ? "Completed" : "In progress"} ·{" "}
                      {format(new Date(s.started_at), "dd MMM, h:mm a")}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-1 text-lg font-semibold text-foreground">Question bank</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              Browse common questions and answer outlines — no scoring, no pressure.
            </p>
            <div className="mb-3 flex flex-wrap gap-2">
              {["all", "saved", ...categories].map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={`h-8 rounded-full border px-3 text-xs font-semibold ${
                    category === c
                      ? "border-primary bg-primary-light text-primary"
                      : "border-border text-foreground/80"
                  }`}
                >
                  {c === "all" ? "All" : c === "saved" ? "Saved" : (CATEGORY_LABELS[c] ?? c)}
                </button>
              ))}
            </div>
            <div className="grid gap-2">
              {shown.map((t) => (
                <div
                  key={t.id}
                  className={`rounded-xl border border-border bg-card ${prefs[t.id] === "hidden" ? "opacity-60" : ""}`}
                >
                  <button
                    onClick={() => setOpen(open === t.id ? null : t.id)}
                    aria-expanded={open === t.id}
                    className="flex w-full items-start justify-between gap-3 p-3 text-left"
                  >
                    <span>
                      <span className="block text-sm font-medium text-foreground">
                        {t.question}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {CATEGORY_LABELS[t.category] ?? t.category} · {t.difficulty}
                      </span>
                    </span>
                    <ChevronDown
                      className={`mt-1 h-4 w-4 shrink-0 transition-transform ${open === t.id ? "rotate-180" : ""}`}
                    />
                  </button>
                  {open === t.id && (
                    <div className="border-t border-border p-3 text-sm">
                      <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                        Suggested outline{t.framework?.name ? ` · ${t.framework.name}` : ""}
                      </p>
                      <ol className="list-decimal space-y-0.5 pl-5 text-foreground/90">
                        {(t.framework?.steps ?? []).map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ol>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Use your own real experience — don't memorise or embellish.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          onClick={() => setPref(t.id, prefs[t.id] === "saved" ? null : "saved")}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold"
                        >
                          {prefs[t.id] === "saved" ? (
                            <BookmarkCheck className="h-3.5 w-3.5 text-primary" />
                          ) : (
                            <Bookmark className="h-3.5 w-3.5" />
                          )}
                          {prefs[t.id] === "saved" ? "Saved" : "Save to practise"}
                        </button>
                        <button
                          onClick={() => setPref(t.id, prefs[t.id] === "hidden" ? null : "hidden")}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold"
                        >
                          <EyeOff className="h-3.5 w-3.5" />
                          {prefs[t.id] === "hidden" ? "Show again" : "Don't ask me this"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {hiddenCount > 0 && category !== "saved" && (
                <button
                  onClick={() => setShowHidden((v) => !v)}
                  className="justify-self-start text-xs font-semibold text-primary"
                >
                  {showHidden ? "Hide" : "Show"} {hiddenCount} hidden question
                  {hiddenCount === 1 ? "" : "s"}
                </button>
              )}
              {shown.length === 0 && (
                <p className="flex items-center gap-2 rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
                  <MessageSquareText className="h-4 w-4" /> No questions in this category yet.
                </p>
              )}
            </div>
          </section>
        </div>
      )}
    </CandidateShell>
  );
}

const BAND_TONE: Record<Band, string> = {
  needs_work: "bg-amber/10 text-amber",
  developing: "bg-primary-light text-primary",
  strong: "bg-success-light text-success",
};

function ProgressSection({
  data,
  busy,
  onPractise,
}: {
  data: { progress: Progress };
  busy: boolean;
  onPractise: () => void;
}) {
  const { progress } = data;
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-lg font-semibold text-foreground">Your progress</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {progress.answered} answer{progress.answered === 1 ? "" : "s"} across {progress.sessions}{" "}
        session{progress.sessions === 1 ? "" : "s"}. Only you can see this.
      </p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {progress.byCategory.map((c) => (
          <li key={c.category} className="flex items-center justify-between gap-2 text-sm">
            <span>
              {CATEGORY_LABELS[c.category] ?? c.category}{" "}
              <span className="text-xs text-muted-foreground">({c.count})</span>
            </span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${BAND_TONE[c.band]}`}>
              {BAND_LABELS[c.band]}
            </span>
          </li>
        ))}
      </ul>
      {progress.trend.length >= 2 && (
        <div
          className="mt-4"
          role="img"
          aria-label="Average answer quality per session, oldest to newest"
        >
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
            Recent sessions
          </p>
          <div className="flex h-12 items-end gap-1">
            {progress.trend.map((t) => (
              <div
                key={t.sessionId}
                title={`${Math.round((t.avg / 2) * 100)}%`}
                className="w-6 rounded-t bg-primary/70"
                style={{ height: `${Math.max(8, (t.avg / 2) * 100)}%` }}
              />
            ))}
          </div>
        </div>
      )}
      {progress.weakest.length > 0 && (
        <button
          onClick={onPractise}
          disabled={busy}
          className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Practise {progress.weakest.map((c) => CATEGORY_LABELS[c] ?? c).join(" & ")}
        </button>
      )}
    </section>
  );
}
