import { createAdminClient } from "../_shared/supabaseAdmin.ts";
import { sendEmail, getPublicAppUrl } from "../_shared/resend.ts";
import { interviewScheduledEmail } from "../_shared/templates.ts";
import { mintInterviewJoinToken } from "../_shared/interview-token.ts";
import { sendWhatsappForEvent } from "../_shared/notify.ts";

function formatIst(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// Invoked server-to-server from src/lib/interview.functions.ts's
// scheduleInterview AND rescheduleInterview (via
// supabaseAdmin.functions.invoke), right after reserve_video_interview_slot
// / reschedule_video_interview succeeds. Fire-and-forget from the caller's
// side — a failure here must never fail the scheduling itself (CLAUDE.md:
// "no third-party failure blocks a core flow"), so this never throws; it
// always resolves with an { ok, ... } body describing what happened.
//
// Point 25: now also builds and sends the join link immediately (same
// HMAC token / exp formula interview-reminder uses), instead of waiting for
// the T-30 reminder. Duplicate-send guard: claims the row atomically via
// `UPDATE ... WHERE scheduled_email_sent_at IS NULL ... RETURNING` before
// sending — reschedule_video_interview() already resets
// scheduled_email_sent_at to NULL on every reschedule
// (20260917125938_interview_zoom_scheduling.sql), so this fires exactly once
// per schedule and once per reschedule, never twice for the same version of
// the row. If the send fails, the claim is rolled back to NULL so a retry
// (or the next reschedule) can still send it.
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let interviewId: string | undefined;
  let isReschedule = false;
  try {
    const body = await req.json();
    interviewId = body.interviewId;
    isReschedule = body.isReschedule === true;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (!interviewId) return new Response("interviewId required", { status: 400 });

  const admin = createAdminClient();

  // Atomic claim: only one caller ever gets rows back for a given
  // "version" of the interview (schedule, or each reschedule, since
  // reschedule_video_interview() resets this column to NULL).
  const { data: claimed, error: claimErr } = await admin
    .from("interviews")
    .update({ scheduled_email_sent_at: new Date().toISOString() })
    .eq("id", interviewId)
    .is("scheduled_email_sent_at", null)
    .select("id, candidate_id, mode, scheduled_at, duration_min, status, jobs (title), companies (name)")
    .maybeSingle();
  if (claimErr) {
    console.error("[interview-scheduled] claim failed", interviewId, claimErr);
    return new Response(JSON.stringify({ ok: false, error: "claim_failed" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!claimed) {
    // Either not found, or already claimed (an email for this exact version
    // of the row already went out) — nothing to do, not an error.
    return new Response(JSON.stringify({ ok: true, skipped: "already_sent_or_not_found" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  const iv = claimed;

  // Cancelled interviews must never get this email — a cancel that raced
  // with this invoke (interviewId queued just before cancellation) is the
  // only way status could be anything but scheduled/rescheduled here.
  if (iv.status === "cancelled") {
    return new Response(JSON.stringify({ ok: true, skipped: "cancelled" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("email, full_name")
    .eq("id", iv.candidate_id)
    .maybeSingle();

  void sendWhatsappForEvent(admin, {
    userId: iv.candidate_id,
    templateKey: "interview_scheduled",
    variables: [
      profile?.full_name ?? "there",
      iv.jobs?.title ?? "the role",
      formatIst(iv.scheduled_at),
    ],
    source: "interview_scheduled",
    reference: { interview_id: interviewId },
    // Includes scheduled_at so a reschedule (new time -> new key) still
    // notifies, while a retried call for the same schedule doesn't.
    dedupeKey: `iv_scheduled:${interviewId}:${iv.scheduled_at}`,
  }).catch(() => undefined);

  if (!profile?.email) {
    return new Response(JSON.stringify({ ok: true, skipped: "no_email" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const secret = Deno.env.get("INTERVIEW_HMAC_SECRET");
  let joinUrl: string | null = null;
  if (secret) {
    const exp =
      Math.floor(new Date(iv.scheduled_at).getTime() / 1000) + iv.duration_min * 60 + 30 * 60;
    const token = await mintInterviewJoinToken(
      { interviewId: iv.id, candidateId: iv.candidate_id, exp },
      secret,
    );
    joinUrl = getPublicAppUrl() + "/interview-join?t=" + encodeURIComponent(token);
  } else {
    console.error("[interview-scheduled] INTERVIEW_HMAC_SECRET not configured — sending without join link");
  }

  const { subject, html, text } = interviewScheduledEmail({
    candidateName: profile.full_name ?? null,
    jobTitle: iv.jobs?.title ?? "the role",
    companyName: iv.companies?.name ?? null,
    scheduledAtIso: iv.scheduled_at,
    durationMin: iv.duration_min,
    mode: iv.mode as "video" | "phone" | "onsite",
    joinUrl,
    isReschedule,
  });

  const result = await sendEmail({ to: profile.email, subject, html, text });
  if (!result.ok) {
    console.error("[interview-scheduled] send failed for interview", interviewId, result.error);
    await admin.from("interviews").update({ scheduled_email_sent_at: null }).eq("id", interviewId);
  }
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
