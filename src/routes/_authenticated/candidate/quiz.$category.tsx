import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { CandidateShell } from "@/components/candidate/CandidateShell";
import { Button } from "@/components/ui/button";
import {
  getSkillQuiz,
  submitSkillQuiz,
  type SkillQuiz,
  type SkillQuizResult,
} from "@/lib/quiz.functions";

export const Route = createFileRoute("/_authenticated/candidate/quiz/$category")({
  head: () => ({ meta: [{ title: "Skill quiz · JobsKart" }] }),
  component: Page,
});

function Page() {
  const { category } = Route.useParams();
  const fetchQuiz = useServerFn(getSkillQuiz);
  const submit = useServerFn(submitSkillQuiz);

  const [quiz, setQuiz] = useState<SkillQuiz | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SkillQuizResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const q = await fetchQuiz({ data: { category } });
        if (!cancelled) setQuiz(q);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load this quiz.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  const handleSubmit = async () => {
    if (!quiz) return;
    if (Object.keys(answers).length < quiz.questions.length) {
      toast.error("Please answer every question before submitting.");
      return;
    }
    setSubmitting(true);
    try {
      const r = await submit({ data: { category, answers } });
      setResult(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit the quiz.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <CandidateShell title={`${category} skill quiz`}>
      <Link
        to="/candidate/profile"
        className="inline-flex items-center gap-1 text-sm font-semibold text-primary"
      >
        <ArrowLeft className="h-4 w-4" /> Back to profile
      </Link>

      {error ? (
        <div className="mt-8 rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {error}
        </div>
      ) : !quiz ? (
        <div className="mt-8 grid place-items-center rounded-xl border border-border bg-card p-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : result ? (
        <div className="mt-6 rounded-xl border border-border bg-card p-6 text-center">
          {result.passed ? (
            <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
          ) : (
            <XCircle className="mx-auto h-10 w-10 text-destructive" />
          )}
          <h1 className="mt-3 text-2xl font-bold text-foreground">
            {result.passed ? "You passed!" : "Not quite there"}
          </h1>
          <p className="mt-1 text-muted-foreground">
            Your score: {result.score}% ({result.correctCount}/{result.total} correct)
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Only visible to you — recruiters never see a score, only a pass/fail badge.
          </p>
          {result.passed ? (
            <div className="mx-auto mt-5 inline-flex items-center gap-2 rounded-xl border border-success/30 bg-success-light/40 px-4 py-3">
              <ShieldCheck className="h-5 w-5 text-success" />
              <span className="text-sm font-semibold text-foreground">
                {category} Verified — recruiters hiring for {category} roles will now see this on
                your profile.
              </span>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              You can retake this quiz after the cooldown period — check back on your profile page.
            </p>
          )}
          <div className="mt-6">
            <Link to="/candidate/profile">
              <Button variant="outline">Back to profile</Button>
            </Link>
          </div>
        </div>
      ) : (
        <div className="mt-6">
          <h1 className="text-2xl font-bold text-foreground">{category} skill quiz</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pass mark {quiz.passMark}% · {quiz.questions.length} question
            {quiz.questions.length === 1 ? "" : "s"} · takes about 5 minutes
          </p>
          {quiz.questions.length === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">
              This quiz isn't set up yet. Please check back later.
            </p>
          ) : (
            <div className="mt-6 space-y-4">
              {quiz.questions.map((q, qi) => (
                <fieldset key={q.id} className="rounded-xl border border-border bg-card p-4">
                  <legend className="px-1 text-sm font-semibold text-foreground">
                    {qi + 1}. {q.text}
                  </legend>
                  <div className="mt-2 space-y-1.5">
                    {q.options.map((opt, oi) => (
                      <label
                        key={oi}
                        className="flex items-center gap-2 rounded-lg p-2 text-sm hover:bg-surface"
                      >
                        <input
                          type="radio"
                          name={q.id}
                          checked={answers[q.id] === oi}
                          onChange={() => setAnswers((a) => ({ ...a, [q.id]: oi }))}
                        />
                        {opt}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
              <Button onClick={handleSubmit} disabled={submitting} className="h-11">
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Submit quiz
              </Button>
            </div>
          )}
        </div>
      )}
    </CandidateShell>
  );
}
