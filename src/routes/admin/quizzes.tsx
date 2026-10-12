import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ListChecks, Loader2, Plus, Save, Trash2, X } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/quizzes")({
  head: () => ({ meta: [{ title: "Skill Quizzes · JobsKart Admin" }] }),
  component: Page,
});

// One question as the admin edits it. `id` is kept stable across edits so
// existing candidate attempts (answers keyed by question id) still line up —
// same convention as the certification exam editor in admin/content.tsx.
type DraftQuestion = { id: string; text: string; options: string[]; correct: number };
const MAX_OPTIONS = 6;
const newQuestion = (): DraftQuestion => ({
  id: crypto.randomUUID(),
  text: "",
  options: ["", ""],
  correct: 0,
});

type QuestionSet = {
  id: string;
  category: string;
  pass_mark: number;
  is_active: boolean;
  questions: DraftQuestion[];
  attemptCount?: number;
};

function Page() {
  const [sets, setSets] = useState<QuestionSet[] | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    // `questions` (the answer key) is admin-only readable via the "admin
    // manages quiz sets" RLS policy — fine here since this whole page is
    // gated behind the super_admin route guard.
    const { data, error } = await supabase
      .from("skill_quiz_question_sets")
      .select("id, category, pass_mark, is_active, questions")
      .order("category");
    if (error) return toast.error(error.message);
    const { data: attempts } = await supabase
      .from("candidate_quiz_attempts")
      .select("category");
    const counts = new Map<string, number>();
    for (const a of attempts ?? []) counts.set(a.category, (counts.get(a.category) ?? 0) + 1);
    setSets(
      (data ?? []).map((s) => ({
        ...s,
        questions: (s.questions as unknown as DraftQuestion[]) ?? [],
        attemptCount: counts.get(s.category) ?? 0,
      })),
    );
  };
  useEffect(() => {
    load();
  }, []);

  const patchSet = (category: string, patch: Partial<QuestionSet>) =>
    setSets((prev) => prev?.map((s) => (s.category === category ? { ...s, ...patch } : s)) ?? null);

  const patchQuestion = (category: string, qi: number, patch: Partial<DraftQuestion>) =>
    setSets(
      (prev) =>
        prev?.map((s) =>
          s.category === category
            ? { ...s, questions: s.questions.map((q, i) => (i === qi ? { ...q, ...patch } : q)) }
            : s,
        ) ?? null,
    );

  const addOption = (category: string, qi: number) =>
    setSets(
      (prev) =>
        prev?.map((s) =>
          s.category === category
            ? {
                ...s,
                questions: s.questions.map((q, i) =>
                  i === qi && q.options.length < MAX_OPTIONS ? { ...q, options: [...q.options, ""] } : q,
                ),
              }
            : s,
        ) ?? null,
    );

  const removeOption = (category: string, qi: number, oi: number) =>
    setSets(
      (prev) =>
        prev?.map((s) =>
          s.category === category
            ? {
                ...s,
                questions: s.questions.map((q, i) =>
                  i === qi
                    ? {
                        ...q,
                        options: q.options.filter((_, j) => j !== oi),
                        correct: q.correct >= oi && q.correct > 0 ? q.correct - 1 : q.correct,
                      }
                    : q,
                ),
              }
            : s,
        ) ?? null,
    );

  const save = async (set: QuestionSet) => {
    for (const q of set.questions) {
      if (!q.text.trim()) return toast.error("Every question needs text.");
      if (q.options.some((o) => !o.trim())) return toast.error("Every option needs text.");
    }
    setSaving(true);
    const { error } = await supabase.rpc("admin_upsert_skill_quiz" as never, {
      _category: set.category,
      _pass_mark: set.pass_mark,
      _questions: set.questions,
      _is_active: set.is_active,
    } as never);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`Saved ${set.category} quiz`);
  };

  if (!sets) {
    return (
      <AdminShell title="Skill Quizzes">
        <div className="h-40 animate-pulse rounded-2xl bg-card" />
      </AdminShell>
    );
  }

  return (
    <AdminShell
      title="Skill Quizzes"
      subtitle="One short multiple-choice quiz per role department. A pass shows recruiters a 'Skill Verified' badge on that candidate — never a score. Candidates can retake after the cooldown in Plan Settings (default 30 days)."
    >
      <div className="space-y-3">
        {sets.map((set) => (
          <div key={set.category} className="rounded-2xl border border-border bg-card p-5">
            <button
              type="button"
              onClick={() => setActiveCategory(activeCategory === set.category ? null : set.category)}
              className="flex w-full items-center justify-between gap-3 text-left"
            >
              <div className="flex items-center gap-2">
                <ListChecks className="h-4 w-4 text-primary" />
                <span className="font-bold text-foreground">{set.category}</span>
                <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {set.questions.length} question{set.questions.length === 1 ? "" : "s"}
                </span>
                {!set.is_active && (
                  <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                    Inactive
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {set.attemptCount} attempt{set.attemptCount === 1 ? "" : "s"} so far
                </span>
              </div>
              <span className="text-xs font-semibold text-primary">
                {activeCategory === set.category ? "Collapse" : "Edit"}
              </span>
            </button>

            {activeCategory === set.category && (
              <div className="mt-4 space-y-4 border-t border-border pt-4">
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      value={set.pass_mark}
                      onChange={(e) => patchSet(set.category, { pass_mark: Number(e.target.value) })}
                      className="w-20"
                    />
                    <span className="text-xs font-semibold text-muted-foreground">Pass mark %</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={set.is_active}
                      onChange={(e) => patchSet(set.category, { is_active: e.target.checked })}
                      className="h-4 w-4"
                    />
                    <span className="text-xs font-semibold text-muted-foreground">
                      Active (candidates can take this quiz)
                    </span>
                  </label>
                </div>

                {set.questions.map((q, qi) => (
                  <div key={q.id} className="space-y-3 rounded-xl border border-border bg-surface p-4">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-muted-foreground">Q{qi + 1}</span>
                      <Input
                        placeholder="Question text"
                        value={q.text}
                        onChange={(e) => patchQuestion(set.category, qi, { text: e.target.value })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove question ${qi + 1}`}
                        onClick={() =>
                          patchSet(set.category, {
                            questions: set.questions.filter((_, i) => i !== qi),
                          })
                        }
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                    <div className="space-y-2 pl-7">
                      {q.options.map((opt, oi) => (
                        <div key={oi} className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`correct-${q.id}`}
                            checked={q.correct === oi}
                            onChange={() => patchQuestion(set.category, qi, { correct: oi })}
                            aria-label={`Option ${oi + 1} is correct`}
                            title="Mark as correct answer"
                            className="h-4 w-4 accent-primary"
                          />
                          <Input
                            placeholder={`Option ${oi + 1}`}
                            value={opt}
                            onChange={(e) =>
                              patchQuestion(set.category, qi, {
                                options: q.options.map((o, j) => (j === oi ? e.target.value : o)),
                              })
                            }
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove option ${oi + 1}`}
                            disabled={q.options.length <= 2}
                            onClick={() => removeOption(set.category, qi, oi)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={q.options.length >= MAX_OPTIONS}
                        onClick={() => addOption(set.category, qi)}
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" /> Add option
                      </Button>
                    </div>
                  </div>
                ))}

                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    patchSet(set.category, { questions: [...set.questions, newQuestion()] })
                  }
                >
                  <Plus className="mr-1 h-4 w-4" /> Add question
                </Button>

                <div className="flex justify-end">
                  <Button onClick={() => save(set)} disabled={saving}>
                    {saving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Save {set.category} quiz
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </AdminShell>
  );
}
