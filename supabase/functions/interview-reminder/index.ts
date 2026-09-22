import { createAdminClient } from "../_shared/supabaseAdmin.ts";
import { sendEmail, getPublicAppUrl } from "../_shared/resend.ts";
import { interviewReminderEmail } from "../_shared/templates.ts";
import { mintInterviewJoinToken } from "../_shared/interview-token.ts";

// Invoked every minute by the 'interview-t30-reminder' pg_cron schedule (see
// the migration alongside this function) via net.http_post, authorized with
// the service-role key stored in Supabase Vault — same wiring as
// alert-digest. Also invoked fire-and-forget from the TanStack app as a
// catch-up when someone opens an interview screen around T-30.
//
// Claims due interviews with an atomic UPDATE ... RETURNING
// (reminder_email_sent_at IS NULL guards against double-send). Send window:
// scheduled_at - 30min through scheduled_at + duration + 15min (join-window
// close). A cron miss after start still sends once if the interview is live.

const REMINDER_LEAD_MS = 30 * 60_000;
const JOIN_BUFFER_MS = 15 * 60_000;
const MAX_DURATION_MS = 240 * 60_000;

function stillSendable(scheduledAtIso: string, durationMin: number, now: Date): boolean {
  const start = new Date(scheduledAtIso).getTime();
  const t30 = start - REMINDER_LEAD_MS;
  const closes = start + durationMin * 60_000 + JOIN_BUFFER_MS;
  const t = now.getTime();
  return t >= t30 && t <= closes;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const secret = Deno.env.get("INTERVIEW_HMAC_SECRET");
  if (!secret) {
    console.error("[interview-reminder] INTERVIEW_HMAC_SECRET not configured");
    return new Response("INTERVIEW_HMAC_SECRET not configured", { status: 500 });
  }

  const admin = createAdminClient();
  const now = new Date();
  const claimFrom = new Date(now.getTime() - MAX_DURATION_MS - JOIN_BUFFER_MS);
  const claimUntil = new Date(now.getTime() + REMINDER_LEAD_MS);

  const { data: claimed, error } = await admin
    .from("interviews")
    .update({ reminder_email_sent_at: now.toISOString() })
    .lte("scheduled_at", claimUntil.toISOString())
    .gte("scheduled_at", claimFrom.toISOString())
    .is("reminder_email_sent_at", null)
    .in("status", ["scheduled", "rescheduled"])
    .select("id, candidate_id, mode, scheduled_at, duration_min, job_id, company_id");

  if (error) {
    console.error("[interview-reminder] claim failed", error);
    return new Response("ok", { status: 200 });
  }

  const due = (claimed ?? []).filter((iv) =>
    stillSendable(iv.scheduled_at, iv.duration_min, now),
  );
  const expired = (claimed ?? []).filter(
    (iv) => !stillSendable(iv.scheduled_at, iv.duration_min, now),
  );
  // Too late to join — leave reminder_email_sent_at set so we don't retry.

  const appUrl = getPublicAppUrl();
  let sent = 0;

  for (const iv of due) {
    const [{ data: profile }, { data: job }, { data: company }] = await Promise.all([
      admin.from("profiles").select("email, full_name").eq("id", iv.candidate_id).maybeSingle(),
      iv.job_id
        ? admin.from("jobs").select("title").eq("id", iv.job_id).maybeSingle()
        : Promise.resolve({ data: null }),
      iv.company_id
        ? admin.from("companies").select("name").eq("id", iv.company_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    if (!profile?.email) continue;

    const exp =
      Math.floor(new Date(iv.scheduled_at).getTime() / 1000) + iv.duration_min * 60 + 30 * 60;
    const token = await mintInterviewJoinToken(
      { interviewId: iv.id, candidateId: iv.candidate_id, exp },
      secret,
    );
    const joinUrl = appUrl + "/interview-join?t=" + encodeURIComponent(token);

    const { subject, html, text } = interviewReminderEmail({
      candidateName: profile.full_name ?? null,
      jobTitle: job?.title ?? "the role",
      companyName: company?.name ?? null,
      scheduledAtIso: iv.scheduled_at,
      mode: iv.mode as "video" | "phone" | "onsite",
      joinUrl,
    });

    const result = await sendEmail({ to: profile.email, subject, html, text });
    if (result.ok) {
      sent++;
    } else {
      console.error("[interview-reminder] send failed for interview", iv.id, result.error);
      await admin.from("interviews").update({ reminder_email_sent_at: null }).eq("id", iv.id);
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      claimed: (claimed ?? []).length,
      due: due.length,
      expired: expired.length,
      emailsSent: sent,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
});
