// Candidate-facing role-skill quiz (see supabase/migrations/20261013100000_skill_quiz.sql).
// Both RPCs are callable directly via supabase.rpc() (authenticated-granted,
// auth.uid()-checked inside), but are wrapped here — same reason
// getCertificationExam/submitCertificationExam in learning.functions.ts are
// wrapped — to turn the server's error-code strings into messages the UI can
// show directly, and to parse the "on_cooldown:<timestamp>" error into a
// structured retry-at date instead of a raw string the UI would have to
// re-parse itself.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type QuizQuestion = { id: string; text: string; options: string[] };
export type SkillQuiz = { questions: QuizQuestion[]; passMark: number };
export type SkillQuizResult = { score: number; passed: boolean; correctCount: number; total: number };

const COOLDOWN_RE = /^on_cooldown:(.+)$/;

/** Thrown with a `retryAt` Date attached when the candidate is on cooldown for this category. */
export class QuizCooldownError extends Error {
  retryAt: Date;
  constructor(retryAt: Date) {
    super(
      `You've already taken this quiz recently — you can retake it after ${retryAt.toLocaleDateString()}.`,
    );
    this.name = "QuizCooldownError";
    this.retryAt = retryAt;
  }
}

const QUIZ_ERRORS: Record<string, string> = {
  not_authenticated: "Please sign in again.",
  quiz_unavailable: "This skill quiz isn't available yet — check back soon.",
  invalid_answers: "Something went wrong submitting your answers. Please try again.",
};

function toQuizError(raw: string): Error {
  const cooldown = raw.match(COOLDOWN_RE);
  if (cooldown) return new QuizCooldownError(new Date(cooldown[1]));
  const code = Object.keys(QUIZ_ERRORS).find((k) => raw.includes(k));
  return new Error(code ? QUIZ_ERRORS[code] : "Could not load the quiz. Please try again.");
}

export const getSkillQuiz = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ category: z.string().min(1) }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("get_skill_quiz", {
      _category: data.category,
    });
    if (error) throw toQuizError(error.message);
    return result as unknown as SkillQuiz;
  });

export const submitSkillQuiz = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z
      .object({
        category: z.string().min(1),
        // question id -> selected option index. Graded entirely server-side
        // against the real answer key, which the browser never receives.
        answers: z.record(z.string(), z.number().int().min(0)),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("submit_skill_quiz", {
      _category: data.category,
      _answers: data.answers as Json,
    });
    if (error) throw toQuizError(error.message);
    return result as unknown as SkillQuizResult;
  });
