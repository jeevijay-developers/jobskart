import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ArrowLeft, Award, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { supabase } from "@/integrations/supabase/client";
import {
  getCertificationExam,
  submitCertificationExam,
  type CertificationExam,
  type CertificationExamResult,
} from "@/lib/learning.functions";

export const Route = createFileRoute("/learn_/certification/$slug_/exam")({
  head: () => ({ meta: [{ title: "Certification exam · JobsKart" }] }),
  component: ExamPage,
});

function ExamPage() {
  const { slug } = Route.useParams();
  const fetchExam = useServerFn(getCertificationExam);
  const submit = useServerFn(submitCertificationExam);

  const [certId, setCertId] = useState<string | null>(null);
  const [exam, setExam] = useState<CertificationExam | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CertificationExamResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        if (!cancelled) setError("Please sign in to take this exam.");
        return;
      }
      const { data } = await supabase
        .from("content_items")
        .select("id")
        .eq("slug", slug)
        .eq("content_type", "certification")
        .eq("status", "published")
        .maybeSingle();
      if (cancelled) return;
      if (!data) {
        // Routed through `error`, not a separate not-found state: the render below
        // only branches on error/!exam/result, so a distinct "not_found" value here
        // was previously set but never checked — an unrecognised slug just spun
        // forever instead of showing anything.
        setError("This certification isn't available.");
        return;
      }
      setCertId(data.id);
      try {
        const e = await fetchExam({ data: { certificationId: data.id } });
        if (!cancelled) setExam(e);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the exam.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const handleSubmit = async () => {
    if (!exam || certId === null) return;
    if (Object.keys(answers).length < exam.questions.length) {
      toast.error("Please answer every question before submitting.");
      return;
    }
    setSubmitting(true);
    try {
      const r = await submit({ data: { certificationId: certId, answers } });
      setResult(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit the exam.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface">
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <Link
          to="/learn/certification/$slug"
          params={{ slug }}
          className="inline-flex items-center gap-1 text-sm font-semibold text-primary"
        >
          <ArrowLeft className="h-4 w-4" /> Back to certification
        </Link>

        {error ? (
          <div className="mt-8 rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            {error}
          </div>
        ) : !exam ? (
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
              Score: {result.score}% ({result.correctCount}/{result.total} correct)
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Attempt {result.attemptsUsed} of {result.maxAttempts}
            </p>
            {!result.passed && result.attemptsUsed < result.maxAttempts && (
              <button
                onClick={() => {
                  setResult(null);
                  setAnswers({});
                }}
                className="mt-4 inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground"
              >
                Try again
              </button>
            )}
            {!result.passed && result.attemptsUsed >= result.maxAttempts && (
              <p className="mt-4 text-sm text-muted-foreground">
                You've used all your attempts for this certification.
              </p>
            )}
          </div>
        ) : (
          <div className="mt-6">
            <div className="flex items-center gap-2">
              <Award className="h-6 w-6 text-primary" />
              <h1 className="text-2xl font-bold text-foreground">Certification exam</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Pass mark {exam.passMark}% · Attempt {exam.attemptsUsed + 1} of {exam.maxAttempts}
            </p>
            {exam.questions.length === 0 ? (
              <p className="mt-6 text-sm text-muted-foreground">
                This certification's exam isn't set up yet. Please check back later.
              </p>
            ) : (
              <div className="mt-6 space-y-4">
                {exam.questions.map((q, qi) => (
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
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Submit exam
                </button>
              </div>
            )}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
