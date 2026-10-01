// Server functions for the Learning & Content Ecosystem (posts / courses /
// certifications). Public reads (published content) go straight through the
// browser Supabase client from route components, same as jobs.tsx and
// saved.tsx — RLS on content_items + its child tables already scopes those
// to published rows, so no server function is needed for them.
//
// What lives here is what must not run in the browser: money (certification
// checkout, mirroring credits.functions.ts's createRazorpayOrder /
// verifyRazorpayPayment) and admin content authoring.
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, Json } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ── Candidate: buy a certification ──────────────────────────────────────

const ORDER_ERRORS: Record<string, string> = {
  not_authenticated: "Please sign in again.",
  certification_unavailable: "This certification isn't available right now.",
  certification_free: "This certification doesn't require payment.",
  course_unavailable: "This course isn't available right now.",
  course_free: "This course doesn't require payment.",
  already_purchased: "You already own this.",
};
function friendlyOrderError(raw: string) {
  const code = Object.keys(ORDER_ERRORS).find((k) => raw.includes(k));
  return code ? ORDER_ERRORS[code] : "Could not start checkout. Please try again.";
}

type OrderQuote = { order_id: string; amount_paise: number; amount_inr: number; title: string };

/**
 * Shared by createCertificationOrder / createCourseOrder: call the RPC that
 * freezes the price and opens a 'created' candidate_orders row, then open the
 * matching Razorpay gateway order and attach its id. Both RPCs return the
 * same {order_id, amount_paise, amount_inr, title} shape, so one function
 * drives both — the only thing that differs per product is which RPC/receipt
 * prefix/notes-key to use.
 */
async function openCandidateOrder(args: {
  rpc: "create_certification_order" | "create_course_order";
  itemIdKey: "_certification_id" | "_course_id";
  itemId: string;
  receiptPrefix: string;
  noteKey: string;
  actor: string;
}) {
  const { getRazorpayKeys, RAZORPAY_API } = await import("@/lib/razorpay.server");
  const { keyId, secret } = getRazorpayKeys();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Price is frozen server-side inside the RPC — never trust a client-sent amount.
  const { data: quoteRaw, error: quoteErr } = await supabaseAdmin.rpc(args.rpc, {
    [args.itemIdKey]: args.itemId,
    _actor: args.actor,
  } as never);
  if (quoteErr) throw new Error(friendlyOrderError(quoteErr.message));
  const quote = quoteRaw as unknown as OrderQuote;

  // Order id is internal here — the Razorpay gateway order doesn't exist yet at
  // this point (or its creation is exactly what failed), so this can't go
  // through mark_candidate_order_failed(), which is keyed by razorpay_order_id.
  // Update the row directly by its own id instead, mirroring credits.functions.ts.
  const markFailed = (reason: string) =>
    supabaseAdmin
      .from("candidate_orders")
      .update({ status: "failed" })
      .eq("id", quote.order_id)
      .then(() => {
        console.error(`[learning] order ${quote.order_id} failed: ${reason}`);
      });

  const auth = Buffer.from(`${keyId}:${secret}`).toString("base64");
  let order: { id: string; amount: number; currency: string };
  try {
    const res = await fetch(`${RAZORPAY_API}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
      body: JSON.stringify({
        amount: quote.amount_paise,
        currency: "INR",
        receipt: `jk_${args.receiptPrefix}_${quote.order_id}`,
        notes: { jk_order_id: quote.order_id, [args.noteKey]: args.itemId },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Razorpay order failed (${res.status}). ${text.slice(0, 200)}`);
    }
    order = (await res.json()) as { id: string; amount: number; currency: string };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Razorpay order failed.";
    await markFailed(`gateway_error: ${msg}`);
    throw new Error(msg);
  }

  const { error: attachErr } = await supabaseAdmin
    .from("candidate_orders")
    .update({ razorpay_order_id: order.id })
    .eq("id", quote.order_id);
  if (attachErr) {
    await markFailed(`attach_failed: ${attachErr.message}`);
    throw new Error("Could not start checkout. Please try again.");
  }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("full_name, email, mobile")
    .eq("id", args.actor)
    .maybeSingle();

  return {
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId,
    title: quote.title,
    prefill: {
      name: profile?.full_name ?? "",
      email: profile?.email ?? "",
      contact: profile?.mobile ?? "",
    },
  };
}

export const createCertificationOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ certificationId: z.string().uuid() }).parse(data))
  .handler(({ data, context }) =>
    openCandidateOrder({
      rpc: "create_certification_order",
      itemIdKey: "_certification_id",
      itemId: data.certificationId,
      receiptPrefix: "cert",
      noteKey: "certification_id",
      actor: context.userId,
    }),
  );

export const createCourseOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ courseId: z.string().uuid() }).parse(data))
  .handler(({ data, context }) =>
    openCandidateOrder({
      rpc: "create_course_order",
      itemIdKey: "_course_id",
      itemId: data.courseId,
      receiptPrefix: "course",
      noteKey: "course_id",
      actor: context.userId,
    }),
  );

/** Verifies a Razorpay Checkout success callback and grants the purchase — works for
 * both certifications and courses; fulfil_candidate_order() itself reads which one
 * the order was for. */
export const verifyCandidatePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        razorpayOrderId: z.string().min(1),
        razorpayPaymentId: z.string().min(1),
        razorpaySignature: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { getRazorpayKeys, hmacSha256Matches, fulfilCandidateOrder } =
      await import("@/lib/razorpay.server");
    const { secret } = getRazorpayKeys();

    const signed = `${data.razorpayOrderId}|${data.razorpayPaymentId}`;
    if (!hmacSha256Matches(secret, signed, data.razorpaySignature)) {
      throw new Error("Invalid payment signature.");
    }

    let result;
    try {
      result = await fulfilCandidateOrder({
        razorpayOrderId: data.razorpayOrderId,
        razorpayPaymentId: data.razorpayPaymentId,
        amountPaise: null,
        via: "client",
        actor: context.userId,
      });
    } catch (e) {
      throw new Error(friendlyOrderError(e instanceof Error ? e.message : String(e)));
    }
    if (result.status === "amount_mismatch") {
      throw new Error(
        `Payment amount didn't match the order. Contact support with payment ID ${data.razorpayPaymentId}.`,
      );
    }
    return {
      itemType: result.item_type,
      certificateNo: result.certificate_no,
      alreadyApplied: result.already_applied,
    };
  });

export const reportCandidateOrderFailure = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        razorpayOrderId: z.string().min(1),
        razorpayPaymentId: z.string().min(1).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order } = await supabaseAdmin
      .from("candidate_orders")
      .select("user_id")
      .eq("razorpay_order_id", data.razorpayOrderId)
      .maybeSingle();
    // Ownership check happens here, in the server function, not left to RLS
    // alone — this RPC is service-role, so it would otherwise trust the id blindly.
    if (!order || order.user_id !== context.userId) return { ok: false };

    const { error } = await supabaseAdmin.rpc("mark_candidate_order_failed", {
      _razorpay_order_id: data.razorpayOrderId,
      _razorpay_payment_id: (data.razorpayPaymentId ?? null) as string,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Certifications the signed-in candidate already owns — drives the "already purchased" UI. */
export const getMyCertificatePurchases = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("cert_purchases")
      .select("certification_id, certificate_no, purchased_at")
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return data;
  });

/** Courses the signed-in candidate already owns — drives the "already purchased" UI. */
export const getMyCoursePurchases = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("course_purchases")
      .select("course_id, purchased_at")
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return data;
  });

// ── Course lesson content (purchase-gated) ────────────────────────────────
// body_md/video_url are revoked from anon/authenticated at the column level
// (see 20260930150000/1) — this RPC is the only way to read a locked
// lesson's content, and it checks ownership before returning anything.

const LESSON_ERRORS: Record<string, string> = {
  lesson_not_found: "This lesson isn't available.",
};

/**
 * Public route: works for a signed-out visitor viewing a free-preview lesson too,
 * so it deliberately doesn't use requireSupabaseAuth (which throws without a
 * token) — auth.uid() inside the RPC is simply NULL for a signed-out caller, and
 * the RPC treats that as "not purchased". Mirrors auth-middleware.ts's JWT
 * extraction, but falls back to an anonymous client instead of rejecting.
 */
async function optionalAuthSupabase() {
  const { getRequest } = await import("@tanstack/react-start/server");
  const { createClient } = await import("@supabase/supabase-js");
  const SUPABASE_URL = process.env.SUPABASE_URL!;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
  const token = getRequest()
    ?.headers?.get("authorization")
    ?.replace(/^Bearer /, "");
  return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

export const getLessonContent = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({ lessonId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const supabase = await optionalAuthSupabase();
    const { data: result, error } = await supabase.rpc("get_lesson_content", {
      _lesson_id: data.lessonId,
    });
    if (error) {
      const code = Object.keys(LESSON_ERRORS).find((k) => error.message.includes(k));
      throw new Error(code ? LESSON_ERRORS[code] : "Could not load this lesson.");
    }
    return result as unknown as
      | {
          unlocked: true;
          courseId: string;
          title: string;
          kind: string;
          videoUrl: string | null;
          bodyMd: string | null;
        }
      | { unlocked: false; courseId: string };
  });

// ── Certification exam ─────────────────────────────────────────────────

const EXAM_ERRORS: Record<string, string> = {
  not_authenticated: "Please sign in again.",
  certification_unavailable: "This certification isn't available right now.",
  not_purchased: "Buy this certification to take the exam.",
  attempts_exhausted: "You've used all your attempts for this certification.",
};
function friendlyExamError(raw: string) {
  const code = Object.keys(EXAM_ERRORS).find((k) => raw.includes(k));
  return code ? EXAM_ERRORS[code] : "Could not load the exam. Please try again.";
}

export type ExamQuestion = { id: string; text: string; options: string[] };
export type CertificationExam = {
  questions: ExamQuestion[];
  passMark: number;
  maxAttempts: number;
  attemptsUsed: number;
};
export type CertificationExamResult = {
  score: number;
  passed: boolean;
  correctCount: number;
  total: number;
  attemptsUsed: number;
  maxAttempts: number;
};

export const getCertificationExam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ certificationId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("get_certification_exam", {
      _certification_id: data.certificationId,
    });
    if (error) throw new Error(friendlyExamError(error.message));
    return result as unknown as CertificationExam;
  });

export const submitCertificationExam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z
      .object({
        certificationId: z.string().uuid(),
        // question id -> selected option index. Grading happens entirely server-side
        // against the real answer key, which the browser never receives.
        answers: z.record(z.string(), z.number().int().min(0)),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("submit_certification_exam", {
      _certification_id: data.certificationId,
      _answers: data.answers as Json,
    });
    if (error) throw new Error(friendlyExamError(error.message));
    return result as unknown as CertificationExamResult;
  });

// ── Admin: author content ───────────────────────────────────────────────
// Uses the caller's own (RLS-bound) client, not the service role — the
// "Admins can manage ..." policies added in the schema migration are the
// actual security boundary; a non-admin's write is rejected by Postgres,
// not just by a role check in this file.

// {id, text, options[], correct} — "correct" is an index into options.
// Exam grading (submit_certification_exam) reads this shape directly, so it's
// validated here rather than accepted as unknown() and hoped-for downstream.
const certQuestionSchema = z
  .object({
    id: z.string().trim().min(1).max(60),
    text: z.string().trim().min(1).max(1000),
    options: z.array(z.string().trim().min(1).max(300)).min(2).max(8),
    correct: z.number().int().min(0),
  })
  .refine((q) => q.correct < q.options.length, { message: "correct must be a valid option index" });

const moduleSchema = z.object({
  title: z.string().trim().min(1).max(200),
  kind: z.enum(["video", "reading", "quiz"]),
  videoUrl: z.string().url().nullish(),
  bodyMd: z.string().max(20000).nullish(),
  quiz: z.unknown().nullish(),
  freePreview: z.boolean().default(false),
  durationMinutes: z.number().int().min(0).max(600).nullish(),
  lessons: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        kind: z.enum(["video", "reading", "quiz"]),
        videoUrl: z.string().url().nullish(),
        bodyMd: z.string().max(20000).nullish(),
        quiz: z.unknown().nullish(),
        freePreview: z.boolean().default(false),
        durationMinutes: z.number().int().min(0).max(600).nullish(),
      }),
    )
    .max(50)
    .default([]),
});

const contentItemSchema = z.object({
  type: z.enum(["post", "course", "certification"]),
  title: z.string().trim().min(3).max(200),
  excerpt: z.string().trim().max(500).nullish(),
  category: z.string().trim().max(80).nullish(),
  tags: z.array(z.string().trim().max(40)).max(20).default([]),
  coverUrl: z.string().url().nullish(),
  bodyMd: z.string().max(50000).nullish(),
  seoTitle: z.string().trim().max(70).nullish(),
  seoDescription: z.string().trim().max(160).nullish(),
  ogImageUrl: z.string().url().nullish(),
  courseModules: z.array(moduleSchema).max(50).default([]),
  coursePriceInr: z.number().min(0).max(1_000_000).default(0),
  certificationDetails: z
    .object({
      priceInr: z.number().min(0).max(1_000_000).default(0),
      provider: z.enum(["first_party", "partner"]).default("first_party"),
      partnerName: z.string().trim().max(120).nullish(),
      passMark: z.number().int().min(0).max(100).default(80),
      maxAttempts: z.number().int().min(1).max(10).default(3),
      validityMonths: z.number().int().min(1).max(120).nullish(),
      questions: z.array(certQuestionSchema).max(200).default([]),
    })
    .nullish(),
});

function slugify(title: string) {
  return (
    title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") +
    "-" +
    Math.random().toString(36).slice(2, 6)
  );
}

export const createContentItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => contentItemSchema.parse(data))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const { data: item, error: itemError } = await supabase
      .from("content_items")
      .insert({
        slug: slugify(data.title),
        title: data.title,
        excerpt: data.excerpt ?? null,
        category: data.category ?? null,
        tags: data.tags,
        status: "draft",
        content_type: data.type,
      })
      .select()
      .single();
    if (itemError) throw new Error(itemError.message);

    // content_items and its type-specific extension row (courses/certifications/
    // content_posts) are separate insert statements, not one transaction — if the
    // second insert throws, the content_items row from above is already committed.
    // Left alone, that produces a permanently orphaned content_item with no price
    // row: every later price edit silently no-ops (UPDATE matches zero rows, no
    // error), which is exactly the "price never saves" bug this comment is here
    // to prevent recurring. Compensate manually: delete the orphan before rethrowing.
    try {
      if (data.type === "post") {
        const { error } = await supabase.from("content_posts").insert({
          id: item.id,
          body_md: data.bodyMd ?? "",
          seo_title: data.seoTitle ?? "",
          seo_description: data.seoDescription ?? "",
          og_image_url: data.ogImageUrl ?? "",
        });
        if (error) throw new Error(error.message);
      } else if (data.type === "course") {
        const { error } = await supabase
          .from("courses")
          .insert({ id: item.id, price_inr: data.coursePriceInr });
        if (error) throw new Error(error.message);
        await insertCourseModules(supabase, item.id, data.courseModules);
      } else {
        const c = data.certificationDetails;
        const { error } = await supabase.from("certifications").insert({
          id: item.id,
          price_inr: c?.priceInr ?? 0,
          provider: c?.provider ?? "first_party",
          partner_name: c?.partnerName ?? null,
          pass_mark: c?.passMark ?? 80,
          max_attempts: c?.maxAttempts ?? 3,
          validity_months: c?.validityMonths ?? null,
          questions: (c?.questions ?? []) as Json,
        });
        if (error) throw new Error(error.message);
      }
    } catch (e) {
      await supabase.from("content_items").delete().eq("id", item.id);
      throw e;
    }

    return item;
  });

async function insertCourseModules(
  supabase: SupabaseClient<Database>,
  courseId: string,
  modules: z.infer<typeof moduleSchema>[],
) {
  // Replace-all: simplest correct approach for an admin-authored course tree;
  // FK ON DELETE CASCADE takes lessons with their module.
  await supabase.from("course_modules").delete().eq("course_id", courseId);
  for (const [position, mod] of modules.entries()) {
    const { data: moduleRow, error: moduleError } = await supabase
      .from("course_modules")
      .insert({
        course_id: courseId,
        position,
        title: mod.title,
        kind: mod.kind,
        video_url: mod.videoUrl ?? null,
        body_md: mod.bodyMd ?? "",
        quiz: (mod.quiz ?? null) as Json | null,
        free_preview: mod.freePreview,
        duration_minutes: mod.durationMinutes ?? null,
      })
      .select()
      .single();
    if (moduleError) throw new Error(moduleError.message);

    for (const [lessonPosition, lesson] of mod.lessons.entries()) {
      const { error } = await supabase.from("course_lessons").insert({
        module_id: moduleRow.id,
        position: lessonPosition,
        title: lesson.title,
        kind: lesson.kind,
        video_url: lesson.videoUrl ?? null,
        body_md: lesson.bodyMd ?? "",
        quiz: (lesson.quiz ?? null) as Json | null,
        free_preview: lesson.freePreview,
        duration_minutes: lesson.durationMinutes ?? null,
      });
      if (error) throw new Error(error.message);
    }
  }
}

// A dedicated update schema, not contentItemSchema.partial(): the create schema's
// `tags`/`courseModules` use `.default([])`, which zod fills in even when the
// field is omitted — so "don't touch tags" would silently arrive as `tags: []`
// and wipe them (same for courseModules, which would delete every module on
// any update that isn't itself editing modules). Every field here is truly
// optional with no default, so omitted really means "leave this alone".
const updateContentItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(3).max(200).optional(),
  excerpt: z.string().trim().max(500).nullish(),
  category: z.string().trim().max(80).nullish(),
  tags: z.array(z.string().trim().max(40)).max(20).optional(),
  coverUrl: z.string().url().nullish(),
  bodyMd: z.string().max(50000).nullish(),
  seoTitle: z.string().trim().max(70).nullish(),
  seoDescription: z.string().trim().max(160).nullish(),
  ogImageUrl: z.string().url().nullish(),
  courseModules: z.array(moduleSchema).max(50).optional(),
  coursePriceInr: z.number().min(0).max(1_000_000).optional(),
  certificationDetails: z
    .object({
      priceInr: z.number().min(0).max(1_000_000).default(0),
      provider: z.enum(["first_party", "partner"]).default("first_party"),
      partnerName: z.string().trim().max(120).nullish(),
      passMark: z.number().int().min(0).max(100).default(80),
      maxAttempts: z.number().int().min(1).max(10).default(3),
      validityMonths: z.number().int().min(1).max(120).nullish(),
      questions: z.array(certQuestionSchema).max(200).default([]),
    })
    .nullish(),
});

export const updateContentItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => updateContentItemSchema.parse(data))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const updates: {
      title?: string;
      excerpt?: string | null;
      category?: string | null;
      tags?: string[];
      cover_url?: string | null;
    } = {};
    if (data.title !== undefined) updates.title = data.title;
    if (data.excerpt !== undefined) updates.excerpt = data.excerpt ?? null;
    if (data.category !== undefined) updates.category = data.category ?? null;
    if (data.tags !== undefined) updates.tags = data.tags;
    if (data.coverUrl !== undefined) updates.cover_url = data.coverUrl ?? null;

    if (Object.keys(updates).length) {
      const { error } = await supabase.from("content_items").update(updates).eq("id", data.id);
      if (error) throw new Error(error.message);
    }

    const { data: itemData, error: fetchError } = await supabase
      .from("content_items")
      .select("content_type")
      .eq("id", data.id)
      .single();
    if (fetchError) throw new Error(fetchError.message);

    if (itemData.content_type === "post") {
      if (
        data.bodyMd !== undefined ||
        data.seoTitle !== undefined ||
        data.seoDescription !== undefined ||
        data.ogImageUrl !== undefined
      ) {
        const { error } = await supabase
          .from("content_posts")
          .update({
            ...(data.bodyMd !== undefined ? { body_md: data.bodyMd } : {}),
            ...(data.seoTitle !== undefined ? { seo_title: data.seoTitle } : {}),
            ...(data.seoDescription !== undefined ? { seo_description: data.seoDescription } : {}),
            ...(data.ogImageUrl !== undefined ? { og_image_url: data.ogImageUrl } : {}),
          })
          .eq("id", data.id);
        if (error) throw new Error(error.message);
      }
    } else if (itemData.content_type === "course") {
      // Price and modules are independent edits — update whichever was actually sent.
      // upsert, not update: a course whose `courses` row never got created (e.g. a
      // prior createContentItem that partially failed) would otherwise have every
      // price edit silently match zero rows and appear to succeed while doing nothing.
      if (data.coursePriceInr !== undefined) {
        const { error } = await supabase
          .from("courses")
          .upsert({ id: data.id, price_inr: data.coursePriceInr });
        if (error) throw new Error(error.message);
      }
      if (data.courseModules) {
        await insertCourseModules(supabase, data.id, data.courseModules);
      }
    } else if (itemData.content_type === "certification" && data.certificationDetails) {
      const c = data.certificationDetails;
      // upsert for the same reason as the course branch above.
      const { error } = await supabase.from("certifications").upsert({
        id: data.id,
        price_inr: c.priceInr,
        provider: c.provider,
        partner_name: c.partnerName ?? null,
        pass_mark: c.passMark,
        max_attempts: c.maxAttempts,
        validity_months: c.validityMonths ?? null,
        questions: c.questions as Json,
      });
      if (error) throw new Error(error.message);
    }

    return { success: true };
  });

export const deleteContentItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    // Deleting content_items cascades to every child table via FK ON DELETE CASCADE.
    const { error } = await context.supabase.from("content_items").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const togglePublish = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const { data: item, error: fetchError } = await supabase
      .from("content_items")
      .select("status")
      .eq("id", data.id)
      .single();
    if (fetchError) throw new Error(fetchError.message);

    const newStatus = item.status === "published" ? "draft" : "published";
    const { error } = await supabase
      .from("content_items")
      .update({
        status: newStatus,
        published_at: newStatus === "published" ? new Date().toISOString() : null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { success: true, status: newStatus };
  });

export const uploadCoverImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z
      .object({
        fileName: z.string().min(1).max(200),
        base64: z.string().min(20),
        mimeType: z.string().min(3),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    // Admin-only in practice (RLS on content_items would reject the item this
    // is attached to), but the storage bucket itself has no row-level policy,
    // so the role check happens here explicitly before any upload runs.
    const { data: isAdmin } = await context.supabase.rpc("has_platform_role", {
      _user_id: context.userId,
      _role: "super_admin",
    });
    if (!isAdmin) throw new Error("Admin access required.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const path = `posts/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
    const { error } = await supabaseAdmin.storage
      .from("learning-media")
      .upload(path, bytes, { contentType: data.mimeType, upsert: false });
    if (error) throw new Error(error.message);

    const { data: urlData } = supabaseAdmin.storage.from("learning-media").getPublicUrl(path);
    return { url: urlData.publicUrl };
  });

/**
 * Full content item for the admin editor, including the columns locked down
 * for anon/authenticated (course lesson body_md/video_url, certification
 * questions — see 20260930150000/1) — admin is a Postgres role check here,
 * not implied by RLS, since RLS only controls row visibility and the column
 * grant applies to the `authenticated` role regardless of admin status.
 */
export const getContentItemForEdit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_platform_role", {
      _user_id: context.userId,
      _role: "super_admin",
    });
    if (!isAdmin) throw new Error("Admin access required.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: item, error } = await supabaseAdmin
      .from("content_items")
      .select(
        "id, title, excerpt, category, tags, cover_url, content_type, " +
          "content_posts(body_md, seo_title, seo_description, og_image_url), " +
          "courses(price_inr), " +
          "course_modules(id, title, kind, video_url, body_md, free_preview, duration_minutes, position, " +
          "course_lessons(id, title, kind, video_url, body_md, free_preview, duration_minutes, position)), " +
          "certifications(price_inr, provider, partner_name, pass_mark, max_attempts, validity_months, questions)",
      )
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    return item;
  });
