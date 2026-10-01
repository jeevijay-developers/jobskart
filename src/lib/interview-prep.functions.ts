import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { chatJSON, transcribeAudio } from "@/lib/ai/provider";
import {
  MAX_ANSWER_CHARS,
  MAX_AUDIO_BYTES,
  MAX_AUDIO_SECONDS,
  VOICE_CONSENT_VERSION,
  isAllowedAudioMime,
  baseMime,
  looksLikeAudio,
  voiceMetrics,
  type VoiceMetrics,
  PROMPT_VERSION,
  FeedbackSchema,
  buildFeedbackPrompt,
  checkAnswer,
  computeProgress,
  computeReadiness,
  computeSkillGap,
  fallbackFeedback,
  type Feedback,
  type Framework,
} from "@/lib/interview-prep";

const CATEGORY_KEYS = [
  "intro",
  "motivation",
  "role_skill",
  "behavioural",
  "situational",
  "logistics",
  "ask_employer",
] as const;

const ERROR_MESSAGES: Record<string, string> = {
  quota_exceeded: "You've reached today's practice limit. Please come back tomorrow.",
  interview_not_found: "We couldn't find that interview.",
  job_not_found: "That job isn't available for practice right now.",
  invalid_role: "Enter a role between 2 and 80 characters.",
  no_questions: "No practice questions are available yet for this role. Please try again later.",
  not_authenticated: "Please sign in again.",
  consent_required: "Please turn on voice practice first.",
};

function friendly(message: string): Error {
  const code = Object.keys(ERROR_MESSAGES).find((c) => message.includes(c));
  if (code) return new Error(ERROR_MESSAGES[code]);
  console.error("[interview-prep]", message);
  return new Error("Something went wrong. Please try again.");
}

const startSchema = z.object({
  contextType: z.enum(["role", "job", "interview"]),
  jobId: z.string().uuid().optional(),
  interviewId: z.string().uuid().optional(),
  roleTitle: z.string().trim().max(80).optional(),
  questionCount: z.number().int().min(3).max(10).default(6),
  categories: z.array(z.enum(CATEGORY_KEYS)).min(1).max(7).optional(),
  /** Content language for this session's questions/TTS/feedback — locked for its lifetime. */
  language: z.enum(["en", "hi"]).default("en"),
});
export type StartPrepInput = z.input<typeof startSchema>;

export const startPrepSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => startSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: id, error } = await context.supabase.rpc("start_interview_prep_session", {
      _context_type: data.contextType,
      _job_id: data.jobId ?? undefined,
      _interview_id: data.interviewId ?? undefined,
      _role_title: data.roleTitle ?? undefined,
      _question_count: data.questionCount,
      _categories: data.categories ?? undefined,
      _language: data.language,
    });
    if (error) throw friendly(error.message);
    return { sessionId: id };
  });

async function aiFeedback(
  args: Parameters<typeof buildFeedbackPrompt>[0],
): Promise<Feedback | null> {
  try {
    const { system, user } = buildFeedbackPrompt(args);
    return await chatJSON({ system, user, temperature: 0.2, maxTokens: 1200 }, FeedbackSchema);
  } catch (e) {
    // Rule 7: AI down / invalid output never blocks practice.
    console.warn("[interview-prep] AI feedback failed, using fallback:", e);
    return null;
  }
}

export type SubmitResult =
  | { status: "needs_more"; message: string }
  | {
      status: "ok";
      answerId: string;
      attempt: number;
      feedback: Feedback;
      source: "ai" | "fallback";
      quotaReached: boolean;
      voice: VoiceMetrics | null;
    };

export const submitPrepAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z
      .object({
        sessionQuestionId: z.string().uuid(),
        answerText: z.string().trim().min(1).max(MAX_ANSWER_CHARS),
        /** Present when the answer was spoken; the text is the candidate-reviewed transcript. */
        voice: z.object({ durationSec: z.number().min(1).max(MAX_AUDIO_SECONDS) }).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<SubmitResult> => {
    const supabase = context.supabase;

    // RLS scopes this to the caller's own question.
    const { data: q, error: qErr } = await supabase
      .from("interview_prep_session_questions")
      .select(
        "id, category, question_text, framework, session_id, interview_prep_sessions(role_title, context, language)",
      )
      .eq("id", data.sessionQuestionId)
      .maybeSingle();
    if (qErr || !q) throw new Error("Question not found.");
    const session = q.interview_prep_sessions as {
      role_title: string;
      context: { skills?: string[] };
      language: "en" | "hi";
    };
    const language = session.language ?? "en";

    const check = checkAnswer(data.answerText, q.category);
    if (!check.ok) return { status: "needs_more", message: check.reason };

    const framework = (q.framework ?? {}) as Framework;
    // Computed from the final, reviewed transcript — never trusted from the client.
    const metrics: VoiceMetrics | null = data.voice
      ? voiceMetrics(data.answerText, data.voice.durationSec)
      : null;

    // Quota is enforced in Postgres (advisory-locked); over-quota degrades to
    // deterministic coaching rather than blocking the session.
    let quotaReached = false;
    const { error: quotaErr } = await supabase.rpc("consume_interview_prep_quota", {
      _kind: "feedback",
    });
    if (quotaErr) {
      if (!quotaErr.message.includes("quota_exceeded")) throw friendly(quotaErr.message);
      quotaReached = true;
    }

    let feedback: Feedback | null = quotaReached
      ? null
      : await aiFeedback({
          roleTitle: session.role_title,
          skills: session.context?.skills ?? [],
          category: q.category,
          question: q.question_text,
          framework,
          answer: data.answerText,
          fromSpeech: !!data.voice,
          language,
        });
    const source = feedback ? "ai" : "fallback";
    feedback ??= fallbackFeedback(data.answerText, q.category, framework, language);

    const { data: last } = await supabase
      .from("interview_prep_answers")
      .select("attempt")
      .eq("session_question_id", q.id)
      .order("attempt", { ascending: false })
      .limit(1)
      .maybeSingle();
    const attempt = ((last?.attempt as number | undefined) ?? 0) + 1;

    const { data: row, error: insErr } = await supabase
      .from("interview_prep_answers")
      .insert({
        session_question_id: q.id,
        candidate_id: context.userId,
        attempt,
        answer_text: data.answerText,
        source: metrics ? "voice" : "typed",
        voice_metrics: metrics ?? undefined,
        feedback,
        feedback_source: source,
        feedback_language: language,
        rubric_version: 1,
        prompt_version: PROMPT_VERSION,
      })
      .select("id")
      .single();
    if (insErr) throw friendly(insErr.message);

    await supabase
      .from("interview_prep_session_questions")
      .update({ state: "answered" })
      .eq("id", q.id);

    return {
      status: "ok",
      answerId: row.id as string,
      attempt,
      feedback,
      source,
      quotaReached,
      voice: metrics,
    };
  });

export const skipPrepQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ sessionQuestionId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("interview_prep_session_questions")
      .update({ state: "skipped" })
      .eq("id", data.sessionQuestionId)
      .eq("state", "pending");
    if (error) throw friendly(error.message);
    return { ok: true };
  });

export const getPrepSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ sessionId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const { data: session } = await supabase
      .from("interview_prep_sessions")
      .select(
        "id, context_type, role_title, context, status, self_check, started_at, finished_at, interview_id, language",
      )
      .eq("id", data.sessionId)
      .maybeSingle();
    if (!session) throw new Error("Practice session not found.");

    const { data: questions } = await supabase
      .from("interview_prep_session_questions")
      .select("id, position, template_id, category, question_text, framework, state")
      .eq("session_id", data.sessionId)
      .order("position");
    const qs = (questions ?? []) as Array<{
      id: string;
      position: number;
      template_id: string | null;
      category: string;
      question_text: string;
      framework: Framework;
      state: "pending" | "answered" | "skipped";
    }>;

    const { data: answers } = await supabase
      .from("interview_prep_answers")
      .select(
        "id, session_question_id, attempt, answer_text, source, voice_metrics, feedback, feedback_source, feedback_language, created_at",
      )
      .in(
        "session_question_id",
        qs.map((x) => x.id),
      )
      .order("attempt");
    type A = {
      id: string;
      session_question_id: string;
      attempt: number;
      answer_text: string;
      feedback: Feedback | null;
      feedback_source: "ai" | "fallback" | null;
      feedback_language: "en" | "hi" | null;
      created_at: string;
    };
    const all = (answers ?? []) as A[];
    const latest = new Map<string, A>();
    for (const a of all) latest.set(a.session_question_id, a); // ordered by attempt asc → last wins

    const readiness = computeReadiness(
      qs.flatMap((x) => {
        const a = latest.get(x.id);
        return a?.feedback
          ? [{ category: x.category, feedback: a.feedback, at: a.created_at }]
          : [];
      }),
    );

    // Skill gap vs candidate-approved profile skills (their own row, via RLS).
    const ctx = session.context as { skills?: string[] };
    let gap = null;
    let resources: Array<{ id: string; title: string; content_url: string; kind: string }> = [];
    if (ctx.skills?.length) {
      const { data: prof } = await supabase
        .from("candidate_profiles")
        .select("skills")
        .eq("user_id", context.userId)
        .maybeSingle();
      gap = computeSkillGap(
        ctx.skills,
        (prof?.skills as string[] | undefined) ?? [],
        all.map((a) => a.answer_text),
      );
      // Curated resources only — never AI-invented courses.
      const topics = [...gap.explore, ...gap.practise].slice(0, 4);
      if (topics.length) {
        const or = topics
          .map((t) => t.replace(/[^\w\s+#-]/g, "").trim())
          .filter(Boolean)
          .flatMap((t) => [`title.ilike.%${t}%`, `category.ilike.%${t}%`])
          .join(",");
        const { data: res } = await supabase
          .from("learning_resources")
          .select("id, title, content_url, kind")
          .eq("is_published", true)
          .or(or)
          .limit(4);
        resources = (res ?? []) as typeof resources;
      }
    }

    const { data: prefRows } = await supabase
      .from("interview_prep_question_prefs")
      .select("template_id, pref")
      .in(
        "template_id",
        qs.map((x) => x.template_id).filter((t): t is string => !!t),
      );
    const prefs: Record<string, "saved" | "hidden"> = {};
    for (const r of (prefRows ?? []) as Array<{ template_id: string; pref: "saved" | "hidden" }>)
      prefs[r.template_id] = r.pref;

    return {
      session,
      prefs,
      questions: qs.map((x) => ({
        ...x,
        answers: all.filter((a) => a.session_question_id === x.id),
      })),
      readiness,
      gap,
      resources,
    };
  });

export const finishPrepSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        selfCheck: z.number().int().min(1).max(5).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("interview_prep_sessions")
      .update({
        status: "completed",
        finished_at: new Date().toISOString(),
        ...(data.selfCheck ? { self_check: data.selfCheck } : {}),
      })
      .eq("id", data.sessionId);
    if (error) throw friendly(error.message);
    return { ok: true };
  });

export const reportPrepItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z
      .object({
        targetType: z.enum(["question", "feedback"]),
        sessionQuestionId: z.string().uuid().optional(),
        answerId: z.string().uuid().optional(),
        category: z.enum(["inaccurate", "irrelevant", "unsafe", "other"]),
        details: z.string().trim().max(1000).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("interview_prep_reports").insert({
      reporter_id: context.userId,
      target_type: data.targetType,
      session_question_id: data.sessionQuestionId ?? null,
      answer_id: data.answerId ?? null,
      category: data.category,
      details: data.details || null,
    });
    if (error) throw friendly(error.message);
    return { ok: true };
  });

/** Self-service deletion. One session, or all practice history when no id is given. */
export const deletePrepHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ sessionId: z.string().uuid().optional() }).parse(data))
  .handler(async ({ data, context }) => {
    // RLS limits deletes to the caller's own rows; FK cascades remove questions + answers.
    let q = context.supabase.from("interview_prep_sessions").delete();
    q = data.sessionId ? q.eq("id", data.sessionId) : q.eq("candidate_id", context.userId);
    const { error } = await q;
    if (error) throw friendly(error.message);
    return { ok: true };
  });

/** Save a question to practise, hide it ("don't ask again"), or clear the choice. */
export const setQuestionPref = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z
      .object({ templateId: z.string().uuid(), pref: z.enum(["saved", "hidden"]).nullable() })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const { error } = data.pref
      ? await supabase
          .from("interview_prep_question_prefs")
          .upsert(
            { candidate_id: context.userId, template_id: data.templateId, pref: data.pref },
            { onConflict: "candidate_id,template_id" },
          )
      : await supabase
          .from("interview_prep_question_prefs")
          .delete()
          .eq("candidate_id", context.userId)
          .eq("template_id", data.templateId);
    if (error) throw friendly(error.message);
    return { ok: true };
  });

/** Progress across all of the candidate's sessions (latest attempt per question). */
export const getPrepProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase;
    const { data: rows } = await supabase
      .from("interview_prep_answers")
      .select(
        "attempt, feedback, created_at, session_question_id, interview_prep_session_questions(category, session_id)",
      )
      .not("feedback", "is", null)
      .order("created_at", { ascending: false })
      .limit(500);
    type R = {
      attempt: number;
      feedback: Feedback;
      created_at: string;
      session_question_id: string;
      interview_prep_session_questions: { category: string; session_id: string } | null;
    };
    const latest = new Map<string, R>();
    for (const r of (rows ?? []) as R[]) {
      const cur = latest.get(r.session_question_id);
      if (!cur || r.attempt > cur.attempt) latest.set(r.session_question_id, r);
    }
    const progress = computeProgress(
      [...latest.values()].flatMap((r) =>
        r.interview_prep_session_questions
          ? [
              {
                category: r.interview_prep_session_questions.category,
                feedback: r.feedback,
                at: r.created_at,
                sessionId: r.interview_prep_session_questions.session_id,
              },
            ]
          : [],
      ),
    );
    const { data: last } = await supabase
      .from("interview_prep_sessions")
      .select("role_title")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return { progress, lastRoleTitle: (last?.role_title as string | undefined) ?? null };
  });

// ── Voice practice ─────────────────────────────────────────────────────────

export const getVoiceConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("interview_prep_voice_consent")
      .select("version")
      .eq("candidate_id", context.userId)
      .maybeSingle();
    return { consented: !!data && data.version >= VOICE_CONSENT_VERSION };
  });

/** consent=true records versioned consent; false withdraws it. Typing is unaffected either way. */
export const setVoiceConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ consent: z.boolean() }).parse(data))
  .handler(async ({ data, context }) => {
    const table = context.supabase.from("interview_prep_voice_consent");
    const del = await table.delete().eq("candidate_id", context.userId);
    if (del.error) throw friendly(del.error.message);
    if (data.consent) {
      const { error } = await context.supabase
        .from("interview_prep_voice_consent")
        .insert({ candidate_id: context.userId, version: VOICE_CONSENT_VERSION });
      if (error) throw friendly(error.message);
    }
    return { consented: data.consent };
  });

const TRANSCRIBE_FAILED =
  "We couldn't turn your recording into text. You can try again, or type your answer instead.";

/**
 * Transcribes ONE recorded answer in memory. The audio is never written anywhere — not to
 * storage, not to the database, not to logs. Consent is enforced here, not just in the UI.
 */
export const transcribePrepAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z
      .object({
        // base64 inflates by ~4/3
        audioB64: z
          .string()
          .min(100)
          .max(Math.ceil((MAX_AUDIO_BYTES * 4) / 3) + 16),
        mime: z.string().min(5).max(80),
        durationSec: z
          .number()
          .min(1)
          .max(MAX_AUDIO_SECONDS + 5),
        language: z.enum(["en", "hi"]).default("en"),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: consent } = await context.supabase
      .from("interview_prep_voice_consent")
      .select("version")
      .eq("candidate_id", context.userId)
      .maybeSingle();
    if (!consent || consent.version < VOICE_CONSENT_VERSION) throw friendly("consent_required");

    if (!isAllowedAudioMime(data.mime)) throw new Error("This audio format isn't supported.");
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(data.audioB64), (c) => c.charCodeAt(0));
    } catch {
      throw new Error(TRANSCRIBE_FAILED);
    }
    if (bytes.length > MAX_AUDIO_BYTES)
      throw new Error("That recording is too long. Keep answers under 2 minutes.");
    if (!looksLikeAudio(bytes, data.mime))
      throw new Error("That doesn't look like a valid recording. Please try again.");

    const { error: quotaErr } = await context.supabase.rpc("consume_interview_prep_quota", {
      _kind: "voice",
    });
    if (quotaErr) {
      if (quotaErr.message.includes("quota_exceeded"))
        throw new Error("You've reached today's voice limit. You can keep practising by typing.");
      throw friendly(quotaErr.message);
    }

    let text = "";
    try {
      text = await transcribeAudio({
        b64: data.audioB64,
        mime: baseMime(data.mime),
        language: data.language,
      });
    } catch (e) {
      // Rule 7: a speech-provider failure never blocks practice — typing still works.
      console.error(
        "[interview-prep] transcription failed:",
        e instanceof Error ? e.message : "unknown",
      );
      throw new Error(TRANSCRIBE_FAILED);
    }
    text = text.slice(0, MAX_ANSWER_CHARS).trim();
    if (!text)
      throw new Error(
        "We couldn't hear any speech in that recording. Check your microphone and try again.",
      );
    return { transcript: text };
  });

// ── Admin: question translations (content, not UI chrome) ───────────────────
// AI drafts once, here, at admin-trigger time only — never at session start. A
// human reviews/edits before `saveQuestionTranslation` can mark it published;
// nothing here is shown to a candidate until that happens (RLS has no candidate
// SELECT policy on the translations table at all — see the migration).
const TranslationDraftSchema = z.object({
  question: z.string().trim().min(1).max(500),
  steps: z.array(z.string().trim().min(1).max(200)).max(10),
});

export const draftQuestionTranslation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z.object({ templateId: z.string().uuid(), language: z.literal("hi") }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_platform_role", {
      _user_id: context.userId,
      _role: "super_admin",
    });
    if (!isAdmin) throw new Error("Admin access required.");

    const { data: tmpl, error: tmplErr } = await context.supabase
      .from("interview_prep_question_templates")
      .select("question, framework")
      .eq("id", data.templateId)
      .maybeSingle();
    if (tmplErr || !tmpl) throw new Error("Template not found.");
    const framework = (tmpl.framework ?? {}) as Framework;
    const steps = framework.steps ?? [];

    const system =
      "You are a professional Hindi translator for a job-interview coaching product aimed at blue-collar and grey-collar job seekers in India. Translate plainly and simply — this is a draft a human will review before anyone sees it.";
    const user = `Translate this interview question and its outline steps into simple, plain Hindi (Devanagari script). Return exactly the same number of steps, in the same order, as a translation (not a rewrite) of each.
Return JSON only: {"question": string, "steps": string[]}

Question: ${tmpl.question}
Steps: ${JSON.stringify(steps)}`;

    let translated: { question: string; steps: string[] };
    try {
      // Generous headroom: Devanagari output + this model's hidden "thinking"
      // tokens can eat a tight budget and truncate the JSON (see chatJSON's
      // retry logic in provider.ts for the full explanation).
      translated = await chatJSON(
        { system, user, temperature: 0.2, maxTokens: 2000 },
        TranslationDraftSchema,
      );
    } catch (e) {
      throw friendly(e instanceof Error ? e.message : "translation_failed");
    }

    const { error: upErr } = await context.supabase
      .from("interview_prep_question_template_translations")
      .upsert({
        template_id: data.templateId,
        language: data.language,
        question: translated.question,
        framework: { ...framework, steps: translated.steps },
        status: "draft",
        created_by: context.userId,
      });
    if (upErr) throw friendly(upErr.message);

    return translated;
  });
