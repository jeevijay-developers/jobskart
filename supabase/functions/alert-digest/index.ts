import { createAdminClient } from "../_shared/supabaseAdmin.ts";
import { sendEmail } from "../_shared/resend.ts";
import { jobMatchEmail, type MatchedJob } from "../_shared/templates.ts";
import { matchesAlert } from "../_shared/matching.ts";

type Frequency = "daily" | "weekly";

// Invoked by the two pg_cron schedules set up in the
// 20260914075503_alert_job_notifications.sql migration, each POSTing
// { "frequency": "daily" | "weekly" } via net.http_post, authorized with the
// service-role key stored in Supabase Vault.
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let frequency: Frequency | undefined;
  try {
    ({ frequency } = await req.json());
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (frequency !== "daily" && frequency !== "weekly") {
    return new Response("frequency must be 'daily' or 'weekly'", { status: 400 });
  }

  const admin = createAdminClient();

  const { data: alerts, error: alertsErr } = await admin
    .from("candidate_job_alerts")
    .select("id, user_id, query, frequency, last_sent_at, created_at")
    .eq("frequency", frequency)
    .eq("is_active", true)
    .eq("email_enabled", true);

  if (alertsErr) {
    console.error("[alert-digest] failed to load alerts", alertsErr);
    return new Response("ok", { status: 200 });
  }

  const now = new Date().toISOString();
  let sent = 0;

  for (const alert of alerts ?? []) {
    const windowStart = alert.last_sent_at ?? alert.created_at;

    const { data: jobs, error: jobsErr } = await admin
      .from("jobs")
      .select(
        "id, title, city, min_salary, max_salary, salary_period, company_id, created_at, companies (name)",
      )
      .eq("status", "active")
      .gt("created_at", windowStart)
      .order("created_at", { ascending: true });

    if (jobsErr) {
      console.error("[alert-digest] failed to load jobs for alert", alert.id, jobsErr);
      continue;
    }

    const query = (alert.query ?? {}) as { keyword?: string | null; city?: string | null };
    const matched = (jobs ?? []).filter((j) =>
      matchesAlert({ title: j.title, city: j.city }, query),
    );

    if (matched.length > 0) {
      // Defensive dedup, even though the created_at window should already prevent overlap.
      const { data: already } = await admin
        .from("alert_job_notifications")
        .select("job_id")
        .eq("alert_id", alert.id)
        .in(
          "job_id",
          matched.map((j) => j.id),
        );
      const alreadyIds = new Set((already ?? []).map((r) => r.job_id));
      const toSend = matched.filter((j) => !alreadyIds.has(j.id));

      if (toSend.length > 0) {
        const { data: profile } = await admin
          .from("profiles")
          .select("email")
          .eq("id", alert.user_id)
          .maybeSingle();
        if (profile?.email) {
          const matchedJobs: MatchedJob[] = toSend.map((j) => ({
            id: j.id,
            title: j.title,
            city: j.city,
            min_salary: j.min_salary,
            max_salary: j.max_salary,
            salary_period: j.salary_period,
            company_name: (j.companies as { name: string } | null)?.name ?? null,
          }));
          const { subject, html } = jobMatchEmail(
            { keyword: query.keyword, city: query.city, frequency: alert.frequency },
            matchedJobs,
          );
          const result = await sendEmail({ to: profile.email, subject, html });
          if (result.ok) {
            sent++;
            await admin
              .from("alert_job_notifications")
              .insert(toSend.map((j) => ({ alert_id: alert.id, job_id: j.id })));
          } else {
            console.error("[alert-digest] send failed for alert", alert.id, result.error);
          }
        }
      }
    }

    // Move the window forward regardless of whether anything matched or sent,
    // so a quiet period doesn't keep growing the look-back window forever.
    await admin.from("candidate_job_alerts").update({ last_sent_at: now }).eq("id", alert.id);
  }

  return new Response(
    JSON.stringify({ ok: true, alertsProcessed: (alerts ?? []).length, emailsSent: sent }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
});
