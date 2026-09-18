import { createAdminClient } from "../_shared/supabaseAdmin.ts";
import { sendEmail, getPublicAppUrl } from "../_shared/resend.ts";
import { interviewReminderEmail } from "../_shared/templates.ts";
import { mintInterviewJoinToken } from "../_shared/interview-token.ts";

// Invoked every minute by the 'interview-t30-reminder' pg_cron schedule (see
// the migration alongside this function) via net.http_post, authorized with
// the service-role key stored in Supabase Vault — same wiring as
// alert-digest. Claims due interviews with an atomic UPDATE ... RETURNING
// (reminder_email_sent_at IS NULL guards against double-send from overlapping
// invocations) rather than a SELECT-then-UPDATE, which could double-claim.
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const secret = Deno.env.get("INTERVIEW_HMAC_SECRET");
  if (!secret) {
    console.error("[interview-reminder] INTERVIEW_HMAC_SECRET not configured");
    return new Response("INTERVIEW_HMAC_SECRET not configured", { status: 500 });
  }

  const admin = createAdminClient();
  const now = new Date();
  const in30Min = new Date(now.getTime() + 30 * 60_000);

  const { data: due, error } = await admin
    .from("interviews")
    .update({ reminder_email_sent_at: now.toISOString() })
    .lte("scheduled_at", in30Min.toISOString())
    .gt("scheduled_at", now.toISOString())
    .is("reminder_email_sent_at", null)
    .in("status", ["scheduled", "rescheduled"])
    .select("id, candidate_id, mode, scheduled_at, duration_min, jobs (title), companies (name)");

  if (error) {
    console.error("[interview-reminder] claim failed", error);
    return new Response("ok", { status: 200 });
  }

  const appUrl = getPublicAppUrl();
  let sent = 0;

  for (const iv of due ?? []) {
    const { data: profile } = await admin
      .from("profiles")
      .select("email, full_name")
      .eq("id", iv.candidate_id)
      .maybeSingle();
    if (!profile?.email) continue;

    // Valid well past the interview's own end, matching the join-window
    // buffer in src/lib/interview-window.ts (scheduled_at + duration + 15min)
    // plus headroom so a slightly-late click never hits an expired token.
    const exp =
      Math.floor(new Date(iv.scheduled_at).getTime() / 1000) + iv.duration_min * 60 + 30 * 60;
    const token = await mintInterviewJoinToken(
      { interviewId: iv.id, candidateId: iv.candidate_id, exp },
      secret,
    );
    const joinUrl = appUrl + "/interview-join?t=" + encodeURIComponent(token);

    const { subject, html, text } = interviewReminderEmail({
      candidateName: profile.full_name ?? null,
      jobTitle: iv.jobs?.title ?? "the role",
      companyName: iv.companies?.name ?? null,
      scheduledAtIso: iv.scheduled_at,
      mode: iv.mode as "video" | "phone" | "onsite",
      joinUrl,
    });

    const result = await sendEmail({ to: profile.email, subject, html, text });
    if (result.ok) sent++;
    else console.error("[interview-reminder] send failed for interview", iv.id, result.error);
  }

  return new Response(JSON.stringify({ ok: true, claimed: (due ?? []).length, emailsSent: sent }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
