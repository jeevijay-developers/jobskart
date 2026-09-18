import { createAdminClient } from "../_shared/supabaseAdmin.ts";
import { sendEmail } from "../_shared/resend.ts";
import { interviewScheduledEmail } from "../_shared/templates.ts";

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
