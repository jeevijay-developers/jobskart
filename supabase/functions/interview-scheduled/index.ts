import { createAdminClient } from "../_shared/supabaseAdmin.ts";
import { sendEmail } from "../_shared/resend.ts";
import { interviewScheduledEmail } from "../_shared/templates.ts";
import { sendWhatsappForEvent } from "../_shared/notify.ts";

function formatIst(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// Invoked server-to-server from src/lib/interview.functions.ts's
// scheduleInterview (via supabaseAdmin.functions.invoke), right after
// reserve_video_interview_slot succeeds. Fire-and-forget from the caller's
// side — a failure here must never fail the scheduling itself (CLAUDE.md:
// "no third-party failure blocks a core flow"), so this never throws; it
// always resolves with an { ok, ... } body describing what happened.
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let interviewId: string | undefined;
  try {
    ({ interviewId } = await req.json());
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (!interviewId) return new Response("interviewId required", { status: 400 });

  const admin = createAdminClient();

  const { data: iv, error } = await admin
    .from("interviews")
    .select("id, candidate_id, mode, scheduled_at, duration_min, jobs (title), companies (name)")
    .eq("id", interviewId)
    .maybeSingle();
  if (error || !iv) {
    console.error("[interview-scheduled] interview not found", interviewId, error);
    return new Response(JSON.stringify({ ok: false, error: "interview_not_found" }), {
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

  const { subject, html, text } = interviewScheduledEmail({
    candidateName: profile.full_name ?? null,
    jobTitle: iv.jobs?.title ?? "the role",
    companyName: iv.companies?.name ?? null,
    scheduledAtIso: iv.scheduled_at,
    durationMin: iv.duration_min,
    mode: iv.mode as "video" | "phone" | "onsite",
  });

  const result = await sendEmail({ to: profile.email, subject, html, text });
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
