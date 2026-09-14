import { createAdminClient } from "../_shared/supabaseAdmin.ts";
import { sendEmail } from "../_shared/resend.ts";
import { jobMatchEmail, type MatchedJob } from "../_shared/templates.ts";
import { matchesAlert } from "../_shared/matching.ts";

// Triggered by a Supabase Database Webhook (dashboard-configured) on
// INSERT INTO public.jobs. Payload shape: { type, table, schema, record, old_record }.
// Only handles rows that are already `active` on insert — a job created as
// `draft` and later published via UPDATE is not covered here; the next
// digest run picks it up instead (digests query by created_at, not by when
// status changed).
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let payload: { type?: string; table?: string; record?: Record<string, unknown> };
  try {
    payload = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const job = payload.record;
  if (!job || payload.table !== "jobs" || job.status !== "active") {
    return new Response("ignored", { status: 200 });
  }

  const admin = createAdminClient();

  const { data: alerts, error: alertsErr } = await admin
    .from("candidate_job_alerts")
    .select("id, user_id, query, frequency")
    .eq("frequency", "instant")
    .eq("is_active", true)
    .eq("email_enabled", true);

  if (alertsErr) {
    console.error("[alert-instant-notify] failed to load alerts", alertsErr);
    return new Response("ok", { status: 200 });
  }

  const matching = (alerts ?? []).filter((a) =>
    matchesAlert(
      { title: job.title as string, city: (job.city as string | null) ?? null },
      (a.query ?? {}) as { keyword?: string | null; city?: string | null },
    ),
  );
  if (matching.length === 0) return new Response("no matches", { status: 200 });

  const { data: company } = await admin
    .from("companies")
    .select("name")
    .eq("id", job.company_id as string)
    .maybeSingle();

  const matchedJob: MatchedJob = {
    id: job.id as string,
    title: job.title as string,
    city: (job.city as string | null) ?? null,
    min_salary: (job.min_salary as number | null) ?? null,
    max_salary: (job.max_salary as number | null) ?? null,
    salary_period: (job.salary_period as string | null) ?? null,
    company_name: company?.name ?? null,
  };

  for (const alert of matching) {
    // Dedup guard: unique (alert_id, job_id) — also protects against webhook retries.
    const { error: insertErr } = await admin
      .from("alert_job_notifications")
      .insert({ alert_id: alert.id, job_id: matchedJob.id });
    if (insertErr) {
      // Unique violation means this pair was already notified — skip silently.
      if ((insertErr as { code?: string }).code !== "23505") {
        console.error("[alert-instant-notify] dedup insert failed", insertErr);
      }
      continue;
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("email")
      .eq("id", alert.user_id)
      .maybeSingle();
    if (!profile?.email) continue;

    const query = (alert.query ?? {}) as { keyword?: string | null; city?: string | null };
    const { subject, html, text } = jobMatchEmail(
      { keyword: query.keyword, city: query.city, frequency: alert.frequency },
      [matchedJob],
    );
    const result = await sendEmail({ to: profile.email, subject, html, text });
    if (!result.ok)
      console.error("[alert-instant-notify] send failed for alert", alert.id, result.error);

    await admin
      .from("candidate_job_alerts")
      .update({ last_sent_at: new Date().toISOString() })
      .eq("id", alert.id);
  }

  return new Response("ok", { status: 200 });
});
