import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { chatJSON, transcribeAudio } from "@/lib/ai/provider";
import {
  FeedbackSchema,
  MAX_ANSWER_CHARS,
  MAX_AUDIO_BYTES,
  PROMPT_VERSION,
  baseMime,
  buildFeedbackPrompt,
  fallbackFeedback,
  isAllowedAudioMime,
  looksLikeAudio,
  voiceMetrics,
  type Feedback,
  type Framework,
} from "@/lib/interview-prep";
import {
  CARD_CONSENT_VERSION,
  CARD_MAX_SECONDS,
  CARD_MAX_TAKES,
  cardAudioPath,
  type CandidateCard,
  type CandidateCardItem,
  type EmployerCard,
  type EmployerCardItem,
} from "@/lib/interview-card";

// The generated Database types don't know about the interview_card_* tables/RPCs until
// types.ts is regenerated, so reads/writes here go through this narrow, loosely-typed view.
type Result<T = unknown> = PromiseLike<{ data: T; error: { message: string } | null }>;
type Loose = {
  rpc: (fn: string, args?: Record<string, unknown>) => Result;
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const loose = (client: unknown) => client as Loose;

const BUCKET = "interview-cards";
const SIGNED_URL_TTL_SEC = 15 * 60;

const ERROR_MESSAGES: Record<string, string> = {
  consent_required: "Please accept the Interview Card terms first.",
  invalid_role: "Enter a role between 2 and 80 characters.",
  no_questions:
    "Interview Card questions aren't available for this role yet. Please try again later.",
  card_not_found: "You don't have an Interview Card yet.",
  card_not_published: "Publish your Interview Card before attaching it.",
  min_included: "Keep at least 3 answered questions in your card.",
  item_not_found: "We couldn't find that question.",
  application_not_found: "We couldn't find that application.",
  not_shared: "This candidate hasn't attached an Interview Card.",
  insufficient_permissions: "You don't have access to this candidate.",
  not_authenticated: "Please sign in again.",
  quota_exceeded: "You've reached today's voice limit. Please come back tomorrow.",
};

function friendly(message: string): Error {
  const code = Object.keys(ERROR_MESSAGES).find((c) => message.includes(c));
  if (code) return new Error(ERROR_MESSAGES[code]);
  console.error("[interview-card]", message);
  return new Error("Something went wrong. Please try again.");
}

async function admin() {
  // Loaded lazily: *.functions.ts ships to the client bundle, the service-role client must not.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function purgeAudio(paths: string[]) {
  if (!paths.length) return;
  const { error } = await (await admin()).storage.from(BUCKET).remove(paths);
  // Rows are already gone; a failed purge only leaves an unreachable (private) object behind.
  if (error) console.error("[interview-card] audio purge failed:", error.message, paths.length);
}

async function signedUrls(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!paths.length) return out;
  const { data } = await (await admin()).storage
    .from(BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_SEC);
  for (const row of data ?? []) if (row.path && row.signedUrl) out.set(row.path, row.signedUrl);
  return out;
}

// ── Candidate ──────────────────────────────────────────────────────────────

export const getCardState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = loose(context.supabase);
    const [{ data: consent }, { data: card }, views, shares] = await Promise.all([
      db
        .from("interview_card_consent")
        .select("version")
        .eq("candidate_id", context.userId)
        .maybeSingle(),
      db
        .from("interview_cards")
        .select("id, role_title, language, status, summary_band, published_at")
        .eq("candidate_id", context.userId)
        .maybeSingle(),
      db.rpc("get_my_interview_card_views"),
      db
        .from("interview_card_shares")
        .select("application_id")
        .eq("candidate_id", context.userId)
        .is("revoked_at", null),
    ]);

    const consented = !!consent && consent.version >= CARD_CONSENT_VERSION;
    let result: CandidateCard | null = null;
    if (card) {
      const { data: rows } = await db
        .from("interview_card_items")
        .select(
          "id, position, category, question_text, state, takes, include, duration_sec, transcript, feedback, audio_path",
        )
        .eq("card_id", card.id)
        .order("position");
      const items = (rows ?? []) as Array<CandidateCardItem & { audio_path: string | null }>;
      const urls = await signedUrls(items.map((i) => i.audio_path).filter((p): p is string => !!p));
      result = {
        ...card,
        items: items.map(({ audio_path, ...i }) => ({
          ...i,
          audioUrl: audio_path ? (urls.get(audio_path) ?? null) : null,
        })),
      };
    }
    return {
      consented,
      card: result,
      views:
        ((views.data ?? []) as Array<{
          company_name: string;
          job_title: string;
          viewed_at: string;
        }>) ?? [],
      sharedApplicationIds: ((shares.data ?? []) as Array<{ application_id: string }>).map(
        (s) => s.application_id,
      ),
    };
  });

/** consent=false withdraws everything: shares end, the card and every recording are deleted. */
export const setCardConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ consent: z.boolean() }).parse(data))
  .handler(async ({ data, context }) => {
    const db = loose(context.supabase);
    if (!data.consent) {
      const { data: paths, error } = await db.rpc("delete_my_interview_card");
      if (error) throw friendly(error.message);
      await purgeAudio((paths as string[] | null) ?? []);
    }
    const del = await db.from("interview_card_consent").delete().eq("candidate_id", context.userId);
    if (del.error) throw friendly(del.error.message);
    if (data.consent) {
      const { error } = await db
        .from("interview_card_consent")
        .insert({ candidate_id: context.userId, version: CARD_CONSENT_VERSION });
      if (error) throw friendly(error.message);
    }
    return { consented: data.consent };
  });

/** Starts a fresh card. Any existing card is deleted first (one card per candidate). */
export const startCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z
      .object({
        roleTitle: z.string().trim().min(2).max(80),
        language: z.enum(["en", "hi"]).default("en"),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const db = loose(context.supabase);
    const { data: old, error: delErr } = await db.rpc("delete_my_interview_card");
    if (delErr) throw friendly(delErr.message);
    await purgeAudio((old as string[] | null) ?? []);
    const { data: id, error } = await db.rpc("start_interview_card", {
      _role_title: data.roleTitle,
      _language: data.language,
    });
    if (error) throw friendly(error.message);
    return { cardId: id as string };
  });

const TRANSCRIBE_FAILED = "We couldn't turn your recording into text. Please try recording again.";

/**
 * Records ONE answer: validates the audio, transcribes it, writes server-authored feedback and
 * stores the recording. The transcript is the speech provider's output and is not editable —
 * employers can listen to the audio, so the text must be faithful to it.
 */
export const submitCardAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z
      .object({
        itemId: z.string().uuid(),
        audioB64: z
          .string()
          .min(100)
          .max(Math.ceil((MAX_AUDIO_BYTES * 4) / 3) + 16),
        mime: z.string().min(5).max(80),
        durationSec: z
          .number()
          .min(1)
          .max(CARD_MAX_SECONDS + 5),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const db = loose(context.supabase);

    // RLS scopes both reads to the caller.
    const { data: item } = await db
      .from("interview_card_items")
      .select("id, card_id, template_id, position, category, question_text, takes, audio_path")
      .eq("id", data.itemId)
      .maybeSingle();
    if (!item) throw friendly("item_not_found");
    const { data: card } = await db
      .from("interview_cards")
      .select("id, role_title, language, status")
      .eq("id", item.card_id)
      .maybeSingle();
    if (!card) throw friendly("card_not_found");
    if (card.status !== "in_progress")
      throw new Error("This card is published. Start a new card to re-record.");
    if (item.takes >= CARD_MAX_TAKES) throw new Error("You've used the retake for this question.");

    const { data: consent } = await db
      .from("interview_card_consent")
      .select("version")
      .eq("candidate_id", context.userId)
      .maybeSingle();
    if (!consent || consent.version < CARD_CONSENT_VERSION) throw friendly("consent_required");

    if (!isAllowedAudioMime(data.mime)) throw new Error("This audio format isn't supported.");
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(data.audioB64), (c) => c.charCodeAt(0));
    } catch {
      throw new Error(TRANSCRIBE_FAILED);
    }
    if (bytes.length > MAX_AUDIO_BYTES) throw new Error("That recording is too long.");
    if (!looksLikeAudio(bytes, data.mime))
      throw new Error("That doesn't look like a valid recording. Please try again.");

    for (const kind of ["voice", "feedback"] as const) {
      const { error } = await db.rpc("consume_interview_prep_quota", { _kind: kind });
      if (error) {
        if (error.message.includes("quota_exceeded")) throw friendly("quota_exceeded");
        throw friendly(error.message);
      }
    }

    let transcript = "";
    try {
      transcript = await transcribeAudio({
        b64: data.audioB64,
        mime: baseMime(data.mime),
        language: card.language,
      });
    } catch (e) {
      console.error(
        "[interview-card] transcription failed:",
        e instanceof Error ? e.message : "unknown",
      );
      throw new Error(TRANSCRIBE_FAILED);
    }
    transcript = transcript.slice(0, MAX_ANSWER_CHARS).trim();
    if (!transcript)
      throw new Error("We couldn't hear any speech. Check your microphone and try again.");

    // Feedback is a coaching rubric over the words spoken. AI down => deterministic fallback.
    let framework: Framework = {};
    if (item.template_id) {
      const { data: t } = await db
        .from("interview_prep_question_templates")
        .select("framework")
        .eq("id", item.template_id)
        .maybeSingle();
      framework = (t?.framework ?? {}) as Framework;
    }
    let feedback: Feedback | null = null;
    try {
      const { system, user } = buildFeedbackPrompt({
        roleTitle: card.role_title,
        skills: [],
        category: item.category,
        question: item.question_text,
        framework,
        answer: transcript,
        fromSpeech: true,
        language: card.language,
      });
      feedback = await chatJSON(
        { system, user, temperature: 0.2, maxTokens: 1200 },
        FeedbackSchema,
      );
    } catch (e) {
      console.warn("[interview-card] AI feedback failed, using fallback:", e);
    }
    const source = feedback ? "ai" : "fallback";
    feedback ??= fallbackFeedback(transcript, item.category, framework, card.language);

    // Store the recording (replacing a previous take), then record the row. If the row update
    // loses a race (double submit), the new object is removed again.
    const path = cardAudioPath(context.userId, card.id, item.position, data.mime);
    const adminClient = await admin();
    const up = await adminClient.storage
      .from(BUCKET)
      .upload(path, bytes, { upsert: true, contentType: baseMime(data.mime) });
    if (up.error) {
      console.error("[interview-card] audio upload failed:", up.error.message);
      throw new Error("We couldn't save your recording. Please try again.");
    }

    const { data: updated, error: updErr } = await loose(adminClient)
      .from("interview_card_items")
      .update({
        state: "answered",
        takes: item.takes + 1,
        audio_path: path,
        duration_sec: Math.round(data.durationSec),
        transcript,
        voice_metrics: voiceMetrics(transcript, data.durationSec),
        feedback,
        feedback_source: source,
        feedback_language: card.language,
        rubric_version: 1,
        prompt_version: PROMPT_VERSION,
        answered_at: new Date().toISOString(),
      })
      .eq("id", item.id)
      .eq("takes", item.takes) // optimistic lock: a concurrent submit can't double-count a take
      .select("id");
    if (updErr || !updated?.length) {
      if (path !== item.audio_path) await purgeAudio([path]);
      throw new Error("That answer was already saved. Refresh and try again.");
    }
    // A retake in a different container format leaves the old object behind.
    if (item.audio_path && item.audio_path !== path) await purgeAudio([item.audio_path]);

    return { itemId: item.id as string, takes: item.takes + 1, transcript, feedback, source };
  });

export const setCardItemIncluded = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z.object({ itemId: z.string().uuid(), include: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { error } = await loose(context.supabase).rpc("set_card_item_included", {
      _item_id: data.itemId,
      _include: data.include,
    });
    if (error) throw friendly(error.message);
    return { ok: true };
  });

export const publishCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await loose(context.supabase).rpc("publish_interview_card");
    if (error) throw friendly(error.message);
    return { summaryBand: data as string };
  });

export const deleteCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await loose(context.supabase).rpc("delete_my_interview_card");
    if (error) throw friendly(error.message);
    await purgeAudio((data as string[] | null) ?? []);
    return { ok: true };
  });

export const setApplicationCardShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z.object({ applicationId: z.string().uuid(), share: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { error } = await loose(context.supabase).rpc("set_application_card_share", {
      _application_id: data.applicationId,
      _share: data.share,
    });
    if (error) throw friendly(error.message);
    return { ok: true };
  });

// ── Employer ───────────────────────────────────────────────────────────────

/** Authorisation (membership + unrevoked share) happens inside the RPC; URLs are signed after. */
export const getApplicantCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ applicationId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }): Promise<EmployerCard> => {
    const { data: card, error } = await loose(context.supabase).rpc(
      "get_applicant_interview_card",
      {
        _application_id: data.applicationId,
      },
    );
    if (error) throw friendly(error.message);
    const raw = card as Omit<EmployerCard, "items"> & {
      items: Array<Omit<EmployerCardItem, "audioUrl"> & { audio_path: string | null }>;
    };
    const urls = await signedUrls(
      raw.items.map((i) => i.audio_path).filter((p): p is string => !!p),
    );
    return {
      ...raw,
      items: raw.items.map(({ audio_path, ...i }) => ({
        ...i,
        audioUrl: audio_path ? (urls.get(audio_path) ?? null) : null,
      })),
    };
  });
