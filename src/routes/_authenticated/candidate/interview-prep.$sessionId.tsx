import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { differenceInCalendarDays } from "date-fns";
import {
  Bookmark,
  BookmarkCheck,
  Mic,
  Volume2,
  ExternalLink,
  EyeOff,
  Flag,
  Loader2,
  Lock,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { CandidateShell } from "@/components/candidate/CandidateShell";
import { VoiceRecorder } from "@/components/candidate/VoiceRecorder";
import {
  BAND_LABELS,
  CATEGORY_LABELS,
  CRITERION_LABELS,
  MAX_ANSWER_CHARS,
  paceNote,
  READINESS_LABELS,
  wordCount,
  type Band,
  type Feedback,
  type Framework,
  type VoiceMetrics,
} from "@/lib/interview-prep";
import {
  deletePrepHistory,
  finishPrepSession,
  getPrepSession,
  reportPrepItem,
  setQuestionPref,
  skipPrepQuestion,
  submitPrepAnswer,
} from "@/lib/interview-prep.functions";

export const Route = createFileRoute("/_authenticated/candidate/interview-prep/$sessionId")({
  head: () => ({ meta: [{ title: "Practice interview · JobsKart" }] }),
  component: PrepSessionPage,
});

type Detail = Awaited<ReturnType<typeof getPrepSession>>;
type Q = Detail["questions"][number];

const BAND_STYLE: Record<Band, string> = {
  needs_work: "bg-amber/10 text-amber",
  developing: "bg-primary-light text-primary",
  strong: "bg-success-light text-success",
};

function BandChip({ band }: { band: Band }) {
  // Text label as well as colour, so meaning never depends on colour alone.
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${BAND_STYLE[band]}`}>
      {BAND_LABELS[band]}
    </span>
  );
}

function PrepSessionPage() {
  const { sessionId } = Route.useParams();
  const navigate = useNavigate();
  const fetchSession = useServerFn(getPrepSession);
  const submit = useServerFn(submitPrepAnswer);
  const skip = useServerFn(skipPrepQuestion);
  const finish = useServerFn(finishPrepSession);
  const report = useServerFn(reportPrepItem);
  const remove = useServerFn(deletePrepHistory);
  const savePref = useServerFn(setQuestionPref);
  const [localPrefs, setLocalPrefs] = useState<Record<string, "saved" | "hidden">>({});

  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"brief" | "practice" | "results">("brief");
  const [idx, setIdx] = useState(0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [mode, setMode] = useState<"type" | "speak">("type");
  const [voiceSec, setVoiceSec] = useState<number | null>(null);
  const [transcriptNotice, setTranscriptNotice] = useState(false);
  const [result, setResult] = useState<{
    answerId: string;
    feedback: Feedback;
    source: "ai" | "fallback";
    quotaReached: boolean;
    voice: VoiceMetrics | null;
  } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const d = await fetchSession({ data: { sessionId } });
      setDetail(d);
      return d;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this session.");
      return null;
    }
  }, [fetchSession, sessionId]);

  useEffect(() => {
    void refresh().then((d) => {
      if (d?.session.status === "completed") setView("results");
      else if (d) {
        const firstOpen = d.questions.findIndex((q) => q.state === "pending");
        if (d.questions.some((q) => q.state !== "pending")) {
          setIdx(Math.max(firstOpen, 0));
          setView("practice");
        }
      }
    });
  }, [refresh]);

  if (error)
    return (
      <CandidateShell title="Practice interview">
        <p className="rounded-xl border border-border bg-card p-6 text-sm">{error}</p>
      </CandidateShell>
    );
  if (!detail)
    return (
      <CandidateShell title="Practice interview">
        <div className="grid place-items-center rounded-xl border border-border bg-card p-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </CandidateShell>
    );

  const { session, questions } = detail;
  const ctx = session.context as {
    skills?: string[];
    company?: string;
    work_mode?: string;
    interview_mode?: string;
    scheduled_at?: string;
    min_experience_years?: number;
    max_experience_years?: number;
  };
  const q: Q | undefined = questions[idx];

  const onSubmit = async () => {
    if (!q) return;
    setBusy(true);
    setHint(null);
    try {
      const r = await submit({
        data: {
          sessionQuestionId: q.id,
          answerText: text,
          voice: voiceSec ? { durationSec: voiceSec } : undefined,
        },
      });
      if (r.status === "needs_more") {
        setHint(r.message);
      } else {
        setResult(r);
        if (r.quotaReached)
          toast.info("Daily AI feedback limit reached — showing basic coaching instead.");
        await refresh();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not get feedback.");
    } finally {
      setBusy(false);
    }
  };

  const resetVoice = () => {
    setMode("type");
    setVoiceSec(null);
    setTranscriptNotice(false);
  };

  const readAloud = (t: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t);
    u.lang = "en-IN";
    window.speechSynthesis.speak(u);
  };

  const next = async (skipCurrent = false) => {
    if (skipCurrent && q) {
      try {
        await skip({ data: { sessionQuestionId: q.id } });
      } catch {
        /* non-blocking */
      }
    }
    setResult(null);
    setText("");
    setHint(null);
    resetVoice();
    if (idx + 1 < questions.length) setIdx(idx + 1);
    else await onFinish();
  };

  const onFinish = async () => {
    try {
      await finish({ data: { sessionId } });
    } catch {
      /* results still viewable */
    }
    await refresh();
    setView("results");
  };

  const retry = () => {
    setResult(null);
    setHint(null);
    resetVoice();
  };

  const flag = async (answerId: string) => {
    try {
      await report({ data: { targetType: "feedback", answerId, category: "inaccurate" } });
      toast.success("Thanks — we'll review this feedback.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send report.");
    }
  };

  // ── Brief ──
  if (view === "brief") {
    const days = ctx.scheduled_at
      ? differenceInCalendarDays(new Date(ctx.scheduled_at), new Date())
      : null;
    return (
      <CandidateShell title={session.role_title} subtitle="Your preparation brief">
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-5 text-sm">
            <dl className="grid gap-3 sm:grid-cols-2">
              {ctx.company && <Fact label="Company" value={ctx.company} />}
              {ctx.interview_mode && <Fact label="Interview format" value={ctx.interview_mode} />}
              {days !== null && (
                <Fact
                  label="Time left"
                  value={
                    days > 0
                      ? `${days} day${days === 1 ? "" : "s"} to go`
                      : days === 0
                        ? "Today"
                        : "Interview date has passed"
                  }
                />
              )}
              {ctx.work_mode && <Fact label="Work mode" value={ctx.work_mode} />}
              {(ctx.min_experience_years != null || ctx.max_experience_years != null) && (
                <Fact
                  label="Experience asked"
                  value={`${ctx.min_experience_years ?? 0}${ctx.max_experience_years ? `–${ctx.max_experience_years}` : "+"} years`}
                />
              )}
            </dl>
            {ctx.skills && ctx.skills.length > 0 && (
              <div className="mt-4">
                <p className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">
                  Skills this role asks for
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {ctx.skills.map((s) => (
                    <span
                      key={s}
                      className="rounded-full bg-surface px-2.5 py-1 text-xs font-medium"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card p-5 text-sm">
            <p className="font-semibold text-foreground">Before you start</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-foreground/90">
              <li>
                {questions.length} questions, one at a time — typed answers, no camera or microphone
                needed.
              </li>
              <li>Answer as you would in a real interview, using your own real experience.</li>
              <li>
                Research the company: what they do, where they operate, one thing you like about
                them.
              </li>
            </ul>
            <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Private to you — never shared with employers. AI feedback is coaching and may be
              imperfect.
            </p>
          </div>

          <button
            onClick={() => setView("practice")}
            className="inline-flex h-11 items-center rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground"
          >
            Start practice
          </button>
        </div>
      </CandidateShell>
    );
  }

  // ── Results ──
  if (view === "results") {
    return (
      <Results
        detail={detail}
        onRetry={(i) => {
          setIdx(i);
          setResult(null);
          resetVoice();
          setText("");
          setView("practice");
        }}
        onSelfCheck={async (n) => {
          await finish({ data: { sessionId, selfCheck: n } });
          toast.success("Thanks for the feedback.");
        }}
        onDelete={async () => {
          if (!window.confirm("Delete this practice session and its answers?")) return;
          await remove({ data: { sessionId } });
          void navigate({ to: "/candidate/interview-prep" });
        }}
      />
    );
  }

  // ── Practice ──
  const framework = (q?.framework ?? {}) as Framework;
  const words = wordCount(text);
  return (
    <CandidateShell
      title={session.role_title}
      subtitle={`Question ${idx + 1} of ${questions.length}`}
      actions={
        <button onClick={onFinish} className="text-sm font-semibold text-primary">
          Finish early
        </button>
      }
    >
      {q && (
        <div className="space-y-4">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface" aria-hidden>
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${((idx + (result ? 1 : 0)) / questions.length) * 100}%` }}
            />
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <p className="text-xs font-semibold uppercase text-muted-foreground">
              {CATEGORY_LABELS[q.category] ?? q.category}
            </p>
            <h2 className="mt-1 text-lg font-semibold text-foreground">{q.question_text}</h2>
            {typeof window !== "undefined" && "speechSynthesis" in window && (
              <button
                onClick={() => readAloud(q.question_text)}
                className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold"
              >
                <Volume2 className="h-3.5 w-3.5" /> Read question aloud
              </button>
            )}
            {framework.steps && framework.steps.length > 0 && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer font-semibold text-primary">
                  Need a structure? {framework.name ? `(${framework.name})` : ""}
                </summary>
                <p className="mt-2 text-foreground/90">{framework.steps.join(" → ")}</p>
              </details>
            )}
            {q.template_id && (
              <div className="mt-3 flex flex-wrap gap-2">
                {(() => {
                  const tid = q.template_id as string;
                  const current = localPrefs[tid] ?? detail.prefs[tid];
                  const change = async (pref: "saved" | "hidden" | null) => {
                    const before = current;
                    setLocalPrefs((c) => ({ ...c, [tid]: pref as never }));
                    try {
                      await savePref({ data: { templateId: tid, pref } });
                      if (pref === "hidden")
                        toast.success("Got it — we won't pick this question in new sessions.");
                    } catch (e) {
                      setLocalPrefs((c) => ({ ...c, [tid]: before as never }));
                      toast.error(e instanceof Error ? e.message : "Could not save.");
                    }
                  };
                  return (
                    <>
                      <button
                        onClick={() => change(current === "saved" ? null : "saved")}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold"
                      >
                        {current === "saved" ? (
                          <BookmarkCheck className="h-3.5 w-3.5 text-primary" />
                        ) : (
                          <Bookmark className="h-3.5 w-3.5" />
                        )}
                        {current === "saved" ? "Saved" : "Save to practise again"}
                      </button>
                      <button
                        onClick={() => change(current === "hidden" ? null : "hidden")}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold"
                      >
                        <EyeOff className="h-3.5 w-3.5" />
                        {current === "hidden" ? "Undo" : "Don't ask me this again"}
                      </button>
                    </>
                  );
                })()}
              </div>
            )}
          </div>

          {!result ? (
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="answer" className="text-sm font-semibold text-foreground">
                  Your answer
                </label>
                <div
                  role="group"
                  aria-label="How to answer"
                  className="inline-flex rounded-lg border border-border p-0.5 text-xs font-semibold"
                >
                  <button
                    aria-pressed={mode === "type"}
                    onClick={() => setMode("type")}
                    className={`rounded-md px-3 py-1.5 ${mode === "type" ? "bg-primary-light text-primary" : ""}`}
                  >
                    Type
                  </button>
                  <button
                    aria-pressed={mode === "speak"}
                    onClick={() => setMode("speak")}
                    className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 ${mode === "speak" ? "bg-primary-light text-primary" : ""}`}
                  >
                    <Mic className="h-3.5 w-3.5" /> Speak
                  </button>
                </div>
              </div>
              {mode === "speak" && (
                <div className="mt-3">
                  <VoiceRecorder
                    onCancel={() => setMode("type")}
                    onTranscript={(t, sec) => {
                      setText(t);
                      setVoiceSec(sec);
                      setTranscriptNotice(true);
                      setHint(null);
                      setMode("type");
                    }}
                  />
                </div>
              )}
              {mode === "type" && transcriptNotice && (
                <p
                  role="status"
                  className="mt-3 rounded-lg bg-primary-light p-3 text-sm text-foreground"
                >
                  This is the text we heard. Please read it and fix any mistakes before you get
                  feedback — you can also record again.
                </p>
              )}
              <textarea
                id="answer"
                hidden={mode === "speak"}
                value={text}
                onChange={(e) => {
                  const v = e.target.value.slice(0, MAX_ANSWER_CHARS);
                  setText(v);
                  if (!v.trim()) resetVoice();
                }}
                rows={8}
                placeholder="Type your answer as you would say it in the interview…"
                className="mt-2 w-full rounded-lg border border-border bg-background p-3 text-sm"
              />
              <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                <span>{words} words</span>
                <span>
                  {text.length}/{MAX_ANSWER_CHARS}
                </span>
              </div>
              {hint && (
                <p role="alert" className="mt-3 rounded-lg bg-amber/10 p-3 text-sm text-foreground">
                  {hint}
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={onSubmit}
                  disabled={busy || !text.trim()}
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  {busy ? "Reviewing…" : "Get feedback"}
                </button>
                <button
                  onClick={() => next(true)}
                  disabled={busy}
                  className="h-10 rounded-lg border border-border px-4 text-sm font-semibold"
                >
                  Skip
                </button>
              </div>
            </div>
          ) : (
            <FeedbackCard
              feedback={result.feedback}
              source={result.source}
              voice={result.voice}
              onFlag={() => flag(result.answerId)}
              actions={
                <>
                  <button
                    onClick={retry}
                    className="h-10 rounded-lg border border-border px-4 text-sm font-semibold"
                  >
                    Try this question again
                  </button>
                  <button
                    onClick={() => next()}
                    className="h-10 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground"
                  >
                    {idx + 1 < questions.length ? "Next question" : "See results"}
                  </button>
                </>
              }
            />
          )}
        </div>
      )}
    </CandidateShell>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-muted-foreground">{label}</dt>
      <dd className="capitalize text-foreground">{value}</dd>
    </div>
  );
}

function FeedbackCard({
  feedback,
  source,
  voice,
  onFlag,
  actions,
}: {
  feedback: Feedback;
  source: "ai" | "fallback";
  voice?: VoiceMetrics | null;
  onFlag?: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-foreground">Feedback</h3>
        <span className="text-xs text-muted-foreground">
          {source === "ai" ? "AI coaching · may be imperfect" : "Basic coaching (AI unavailable)"}
        </span>
      </div>
      {voice && (
        <div className="mt-3 rounded-lg bg-surface p-3 text-sm">
          <p className="font-semibold text-foreground">Your spoken answer</p>
          <p className="mt-0.5 text-foreground/90">
            {Math.floor(voice.duration_sec / 60)}:{String(voice.duration_sec % 60).padStart(2, "0")}{" "}
            · about {voice.wpm} words per minute
            {voice.total_fillers > 0
              ? ` · filler words: ${Object.entries(voice.fillers)
                  .map(([w, n]) => `${w} ×${n}`)
                  .join(", ")}`
              : " · no filler words spotted"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {paceNote(voice)} This is about pacing only — it says nothing about your voice, accent
            or how confident you sound.
          </p>
        </div>
      )}
      <ul className="mt-3 space-y-3">
        {feedback.criteria.map((c) => (
          <li key={c.key} className="text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-foreground">{CRITERION_LABELS[c.key]}</span>
              <BandChip band={c.band} />
            </div>
            <p className="mt-0.5 text-muted-foreground">{c.evidence}</p>
            <p className="text-foreground/90">→ {c.tip}</p>
          </li>
        ))}
      </ul>
      {feedback.strengths.length > 0 && (
        <div className="mt-4 text-sm">
          <p className="font-semibold text-foreground">What worked</p>
          <ul className="list-disc pl-5 text-foreground/90">
            {feedback.strengths.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-4 text-sm">
        <p className="font-semibold text-foreground">Improve next</p>
        <ul className="list-disc pl-5 text-foreground/90">
          {feedback.improvements.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </div>
      <div className="mt-4 text-sm">
        <p className="font-semibold text-foreground">Outline to fill with your own experience</p>
        <ol className="list-decimal pl-5 text-foreground/90">
          {feedback.outline.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {actions}
        {onFlag && (
          <button
            onClick={onFlag}
            className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            <Flag className="h-3.5 w-3.5" /> Report this feedback
          </button>
        )}
      </div>
    </div>
  );
}

function Results({
  detail,
  onRetry,
  onSelfCheck,
  onDelete,
}: {
  detail: Detail;
  onRetry: (i: number) => void;
  onSelfCheck: (n: number) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const { readiness, gap, resources, questions, session } = detail;
  const [selfCheck, setSelfCheck] = useState<number | null>(session.self_check ?? null);
  return (
    <CandidateShell
      title="Your practice results"
      subtitle={session.role_title}
      actions={
        <Link to="/candidate/interview-prep" className="text-sm font-semibold text-primary">
          Back to Interview prep
        </Link>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs font-semibold uppercase text-muted-foreground">
            Practice readiness
          </p>
          {readiness.status === "ready" ? (
            <>
              <p className="mt-1 text-2xl font-bold text-foreground">
                {READINESS_LABELS[readiness.band]}
              </p>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {readiness.factors.map((f) => (
                  <li key={f.label} className="flex items-center justify-between gap-2 text-sm">
                    {f.label} <BandChip band={f.band} />
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm text-foreground/90">
                What will improve this: {readiness.next}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">{readiness.needed}</p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            This is coaching feedback for practice. It doesn't predict whether an employer will hire
            you and is never shared.
          </p>
        </div>

        {gap && gap.evidenced.length + gap.practise.length + gap.explore.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-5 text-sm">
            <p className="text-xs font-semibold uppercase text-muted-foreground">
              Skills for this role
            </p>
            <GapRow
              label="Already evidenced"
              tone="bg-success-light text-success"
              items={gap.evidenced}
            />
            <GapRow
              label="Practise explaining"
              tone="bg-primary-light text-primary"
              items={gap.practise}
            />
            <GapRow label="Explore & learn" tone="bg-surface text-foreground" items={gap.explore} />
            <p className="mt-3 text-xs text-muted-foreground">
              Not on your profile doesn't mean you lack it — add real skills to your profile, or use
              these as learning ideas.
            </p>
            {resources.length > 0 && (
              <div className="mt-3 border-t border-border pt-3">
                <p className="mb-1.5 font-semibold text-foreground">Learning resources</p>
                <ul className="space-y-1">
                  {resources.map((r) => (
                    <li key={r.id}>
                      <a
                        href={r.content_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-primary"
                      >
                        {r.title} <ExternalLink className="h-3 w-3" />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="space-y-3">
          {questions.map((x, i) => {
            const a = x.answers[x.answers.length - 1];
            return (
              <div key={x.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">{x.question_text}</p>
                  <button onClick={() => onRetry(i)} className="text-xs font-semibold text-primary">
                    {a ? "Retry" : "Answer"}
                  </button>
                </div>
                {a?.feedback ? (
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-muted-foreground">
                      Attempt {a.attempt} · {a.feedback.improvements[0]}
                    </summary>
                    <p className="mt-2 rounded-lg bg-surface p-3">{a.answer_text}</p>
                    <div className="mt-2">
                      <FeedbackCard
                        feedback={a.feedback}
                        source={a.feedback_source ?? "fallback"}
                      />
                    </div>
                  </details>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {x.state === "skipped" ? "Skipped" : "Not answered"}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <div className="rounded-xl border border-border bg-card p-5 text-sm">
          <p className="font-semibold text-foreground">
            How prepared do you feel? (only you see this)
          </p>
          <div className="mt-2 flex gap-2" role="group" aria-label="Preparedness, 1 to 5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                aria-pressed={selfCheck === n}
                onClick={async () => {
                  setSelfCheck(n);
                  await onSelfCheck(n);
                }}
                className={`h-10 w-10 rounded-lg border text-sm font-semibold ${selfCheck === n ? "border-primary bg-primary-light text-primary" : "border-border"}`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={onDelete}
          className="inline-flex items-center gap-1 text-xs font-semibold text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete this session
        </button>
      </div>
    </CandidateShell>
  );
}

function GapRow({ label, tone, items }: { label: string; tone: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-3">
      <p className="mb-1 font-medium text-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((s) => (
          <span key={s} className={`rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}
