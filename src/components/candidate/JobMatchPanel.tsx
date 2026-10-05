import { useEffect, useMemo, useRef, useState } from "react";
import { Target, CheckCircle2, AlertCircle, Copy, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  computeJobMatch,
  type JobMatchResult,
  type MatchJob,
  type SkillKind,
} from "@/lib/resumeBuilder/jobMatch";
import { extractSkills } from "@/lib/resumeBuilder/jdKeywords";
import type { ResumeSchema } from "@/lib/resumeBuilder/schema";

// "Tailor to this job": check this resume against a job you applied to or saved
// on JobsKart, or against a job description pasted from anywhere. Suggestions
// only — nothing is edited automatically, so keywords are never stuffed in.
type Mode = "job" | "paste";
type PasteItem = { skill: string; on: boolean };
type HistoryRow = { score: number; created_at: string };

const countsLine = (result: JobMatchResult) => {
  const all = [...result.matched, ...result.missing];
  if (all.length === 0) return "No specific skills to check.";
  const count = (kind: SkillKind) => ({
    found: result.matched.filter((s) => s.kind === kind).length,
    total: all.filter((s) => s.kind === kind).length,
  });
  const req = count("required");
  const pref = count("preferred");
  const parts: string[] = [];
  if (req.total > 0) parts.push(`${req.found} of ${req.total} required skills found`);
  if (pref.total > 0) parts.push(`${pref.found} of ${pref.total} nice-to-have`);
  return parts.join(" · ");
};

const historyLine = (rows: HistoryRow[]) =>
  `Last checks: ${rows.map((r) => `${r.score}%`).join(" → ")}`;

const tone = (score: number) =>
  score >= 70 ? "text-success" : score >= 40 ? "text-warning" : "text-destructive";

export function JobMatchPanel({
  resume,
  onJumpToSummary,
}: {
  resume: ResumeSchema;
  onJumpToSummary?: () => void;
}) {
  const [mode, setMode] = useState<Mode>("job");
  const [jobs, setJobs] = useState<MatchJob[]>([]);
  const [jobId, setJobId] = useState("");
  const [jdText, setJdText] = useState("");
  const [pasteItems, setPasteItems] = useState<PasteItem[] | null>(null);
  const [manualSkill, setManualSkill] = useState("");
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [isMobileJobPickerOpen, setIsMobileJobPickerOpen] = useState(false);
  const mobileJobPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isMobileJobPickerOpen) return;

    const dismissOnOutsidePointer = (event: PointerEvent) => {
      if (!mobileJobPickerRef.current?.contains(event.target as Node)) {
        setIsMobileJobPickerOpen(false);
      }
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMobileJobPickerOpen(false);
    };
    const dismissOnScroll = (event: Event) => {
      if (!mobileJobPickerRef.current?.contains(event.target as Node)) {
        setIsMobileJobPickerOpen(false);
      }
    };

    document.addEventListener("pointerdown", dismissOnOutsidePointer);
    document.addEventListener("keydown", dismissOnEscape);
    window.addEventListener("scroll", dismissOnScroll, true);
    return () => {
      document.removeEventListener("pointerdown", dismissOnOutsidePointer);
      document.removeEventListener("keydown", dismissOnEscape);
      window.removeEventListener("scroll", dismissOnScroll, true);
    };
  }, [isMobileJobPickerOpen]);

  const loadHistory = async (forJobId: string) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data, error } = await supabase
      .from("resume_match_history" as never)
      .select("score, created_at")
      .eq("user_id", u.user.id)
      .eq("job_id", forJobId)
      .order("created_at", { ascending: false })
      .limit(5);
    if (error) return;
    setHistory(((data ?? []) as unknown as HistoryRow[]).slice().reverse());
  };

  useEffect(() => {
    if (mode === "job" && jobId) void loadHistory(jobId);
    else setHistory([]);
  }, [mode, jobId]);

  const saveScore = async (result: JobMatchResult, forJobId: string | null, label: string) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    setSaving(true);
    const { error } = await supabase.from("resume_match_history" as never).insert({
      user_id: u.user.id,
      job_id: forJobId,
      label,
      score: result.score,
      matched_count: result.matched.length,
      total_count: result.matched.length + result.missing.length,
    } as never);
    setSaving(false);
    if (error) {
      toast.error("Couldn't save this score. Please try again.");
      return;
    }
    toast.success("Score saved");
    if (forJobId) void loadHistory(forJobId);
  };

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const cols = "id, title, skills, preferred_skills, certifications";
      const [apps, saved] = await Promise.all([
        supabase
          .from("applications")
          .select(`job_id, jobs (${cols})`)
          .eq("candidate_id", u.user.id)
          .limit(30),
        supabase
          .from("saved_jobs")
          .select(`job_id, jobs (${cols})`)
          .eq("user_id", u.user.id)
          .limit(30),
      ]);
      const map = new Map<string, MatchJob>();
      for (const row of [...(apps.data ?? []), ...(saved.data ?? [])] as unknown as {
        jobs: MatchJob | null;
      }[]) {
        if (row.jobs) map.set(row.jobs.id, row.jobs);
      }
      setJobs([...map.values()]);
    })();
  }, []);

  const job = jobs.find((j) => j.id === jobId);
  const jobResult = useMemo(() => (job ? computeJobMatch(resume, job) : null), [resume, job]);

  const pasteSkills = (pasteItems ?? []).filter((i) => i.on).map((i) => i.skill);
  const pasteResult = useMemo<JobMatchResult | null>(
    () =>
      pasteSkills.length
        ? computeJobMatch(resume, {
            id: "pasted",
            title: "",
            skills: pasteSkills,
            certifications: [],
          })
        : null,
    // pasteSkills is derived from pasteItems, which is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resume, pasteItems],
  );

  const analyse = () => {
    const found = extractSkills(jdText);
    setPasteItems(found.map((skill) => ({ skill, on: true })));
    if (found.length === 0) toast.message("No known skills found. Add the ones you see below.");
  };

  const toggleItem = (skill: string) =>
    setPasteItems((items) =>
      (items ?? []).map((i) => (i.skill === skill ? { ...i, on: !i.on } : i)),
    );

  const addManual = () => {
    const skill = manualSkill.trim();
    if (!skill) return;
    setPasteItems((items) => {
      const list = items ?? [];
      if (list.some((i) => i.skill.toLowerCase() === skill.toLowerCase())) return list;
      return [...list, { skill, on: true }];
    });
    setManualSkill("");
  };

  const copySuggestion = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied. Edit it to match your experience.");
    } catch {
      toast.error("Couldn't copy. Select the text and copy it manually.");
    }
  };

  const modeButton = (value: Mode, label: string) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      className={`flex-1 whitespace-nowrap rounded-lg px-2 py-1.5 text-xs font-medium ${
        mode === value
          ? "bg-primary text-primary-foreground"
          : "bg-background text-muted-foreground hover:bg-surface"
      }`}
    >
      {label}
    </button>
  );

  const renderResult = (result: JobMatchResult, titleHint?: string, onSave?: () => void) => (
    <>
      <div className="flex items-center gap-3">
        <Target className={`h-5 w-5 ${tone(result.score)}`} />
        <p className={`text-2xl font-bold ${tone(result.score)}`}>{result.score}%</p>
        <p className="text-xs text-muted-foreground">{countsLine(result)}</p>
      </div>
      {[...result.matched, ...result.missing].some((s) => s.kind === "preferred") && (
        <p className="text-[11px] text-muted-foreground">
          Required skills count double; nice-to-have skills are a bonus.
        </p>
      )}
      {titleHint && !result.titleInHeadline && (
        <p className="rounded-lg bg-warning/10 px-3 py-1.5 text-[11px] text-warning">
          Your summary or target role doesn&apos;t mention “{titleHint}”. Recruiters read those
          first — consider naming the role there if it fits your experience.
        </p>
      )}
      {result.matched.length > 0 && (
        <div className="space-y-1.5">
          {result.matched.map((m) => (
            <div key={m.skill} className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                <CheckCircle2 className="h-3 w-3" /> {m.skill}
                {m.via && <span className="font-normal opacity-75">(as “{m.via}”)</span>}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {m.kind === "preferred" && "nice to have · "}in {m.sections.join(", ")}
              </span>
            </div>
          ))}
        </div>
      )}
      {result.missing.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-foreground">Missing from your resume</p>
          {result.missing.map((m) => (
            <div key={m.skill} className="rounded-lg border border-border bg-background p-2.5">
              <button
                type="button"
                onClick={onJumpToSummary}
                disabled={!onJumpToSummary}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium hover:underline disabled:no-underline ${
                  m.kind === "required"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-warning/10 text-warning"
                }`}
              >
                <AlertCircle className="h-3 w-3" /> {m.skill}
                {m.kind === "preferred" && (
                  <span className="font-normal opacity-75">(nice to have)</span>
                )}
              </button>
              <div className="mt-2 flex items-start gap-2">
                <p className="flex-1 text-[11px] text-muted-foreground">{m.suggestion}</p>
                <button
                  type="button"
                  onClick={() => copySuggestion(m.suggestion)}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-surface hover:text-foreground"
                  aria-label={`Copy suggestion for ${m.skill}`}
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">
            Only write about skills you genuinely have. Add them on your{" "}
            <a href="/candidate/profile" className="font-medium text-primary hover:underline">
              Profile
            </a>{" "}
            or in your summary.
          </p>
        </div>
      )}
      {onSave && (
        <div className="flex items-center justify-between gap-2 border-t border-border pt-2.5">
          <p className="text-[11px] text-muted-foreground">
            {history.length > 0 && historyLine(history)}
          </p>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="h-8 shrink-0 rounded-lg border border-border px-3 text-xs font-semibold text-foreground hover:bg-surface disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save this score"}
          </button>
        </div>
      )}
    </>
  );

  return (
    <div className="space-y-3">
      <div className="flex gap-1 rounded-lg border border-border p-0.5">
        {modeButton("job", "My jobs")}
        {modeButton("paste", "Paste description")}
      </div>

      {mode === "job" && (
        <>
          {jobs.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Apply to or save a job on JobsKart to see how well your resume matches it, or paste a
              job description instead.
            </p>
          ) : (
            <>
              <div ref={mobileJobPickerRef} className="relative lg:hidden">
                <button
                  type="button"
                  onClick={() => setIsMobileJobPickerOpen((open) => !open)}
                  className="form-input flex h-9 w-full items-center justify-between gap-2 py-0 text-left text-sm"
                  aria-expanded={isMobileJobPickerOpen}
                  aria-haspopup="listbox"
                >
                  <span className={`min-w-0 flex-1 truncate ${job ? "text-foreground" : "text-muted-foreground"}`}>
                    {job?.title ?? "Choose a job…"}
                  </span>
                  <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isMobileJobPickerOpen ? "rotate-180" : ""}`} />
                </button>
                {isMobileJobPickerOpen && (
                  <div
                    className="absolute z-30 mt-1 max-h-56 w-full overflow-x-hidden overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-lg"
                    role="listbox"
                    aria-label="Choose a job"
                  >
                    <button
                      type="button"
                      role="option"
                      aria-selected={!jobId}
                      onClick={() => {
                        setJobId("");
                        setIsMobileJobPickerOpen(false);
                      }}
                      className="block w-full truncate rounded-md px-3 py-2 text-left text-sm text-muted-foreground hover:bg-surface"
                    >
                      Choose a job…
                    </button>
                    {jobs.map((j) => (
                      <button
                        key={j.id}
                        type="button"
                        role="option"
                        aria-selected={jobId === j.id}
                        onClick={() => {
                          setJobId(j.id);
                          setIsMobileJobPickerOpen(false);
                        }}
                        className={`block w-full truncate rounded-md px-3 py-2 text-left text-sm hover:bg-surface ${jobId === j.id ? "bg-primary/10 font-medium text-primary" : "text-foreground"}`}
                      >
                        {j.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <select
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
                className="form-input hidden h-9 w-full py-0 text-sm lg:block"
              >
                <option value="">Choose a job…</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                  </option>
                ))}
              </select>
              {jobResult &&
                job &&
                renderResult(jobResult, job.title, () => saveScore(jobResult, job.id, ""))}
            </>
          )}
        </>
      )}

      {mode === "paste" && (
        <>
          <textarea
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
            rows={5}
            placeholder="Paste the job description here…"
            className="form-input w-full py-2 text-sm"
          />
          <button
            type="button"
            onClick={analyse}
            disabled={!jdText.trim()}
            className="h-9 w-full rounded-lg bg-primary text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Find skills
          </button>

          {pasteItems && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-foreground">
                Skills found — untick any that don&apos;t apply
              </p>
              <div className="flex flex-wrap gap-1.5">
                {pasteItems.map((i) => (
                  <label
                    key={i.skill}
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                      i.on
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground line-through"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={i.on}
                      onChange={() => toggleItem(i.skill)}
                    />
                    {i.skill}
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={manualSkill}
                  onChange={(e) => setManualSkill(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addManual())}
                  placeholder="Add a skill the list missed"
                  className="form-input h-9 flex-1 py-0 text-sm"
                />
                <button
                  type="button"
                  onClick={addManual}
                  disabled={!manualSkill.trim()}
                  className="h-9 rounded-lg border border-border px-3 text-xs font-semibold text-foreground hover:bg-surface disabled:opacity-50"
                >
                  Add
                </button>
              </div>
              {!pasteResult && (
                <p className="text-[11px] text-muted-foreground">
                  Select at least one skill to check your resume.
                </p>
              )}
            </div>
          )}
          {pasteResult &&
            renderResult(pasteResult, undefined, () =>
              saveScore(pasteResult, null, "Pasted job description"),
            )}
        </>
      )}
    </div>
  );
}
