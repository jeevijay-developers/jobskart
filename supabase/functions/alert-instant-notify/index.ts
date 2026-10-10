import { createAdminClient } from "../_shared/supabaseAdmin.ts";
import { sendEmail } from "../_shared/resend.ts";
import { jobMatchEmail, type MatchedJob } from "../_shared/templates.ts";
import { getCandidateEmailPrefs } from "../_shared/notificationPrefs.ts";
import { sendWhatsappForEvent } from "../_shared/notify.ts";
import { signUnsubscribeToken } from "../_shared/unsubscribeToken.ts";
import { getPublicAppUrl } from "../_shared/resend.ts";

// v2: driven by the `alert-instant-dispatch` pg_cron job (every 2 minutes,
// see 20261012110000_job_alerts_v2_dispatch.sql), not a dashboard Database
// Webhook. The old webhook only fired on INSERT INTO jobs, which missed every
// employer job today — those are inserted as `draft` and flipped to `active`
// by activate_job_with_tier() via UPDATE (20260924100423_job_tiers_posting.sql).
// The DB-side trigger from the v2 foundation migration now records that
// transition in job_alert_events regardless of INSERT vs UPDATE.
//
// Two jobs per run:
//   1) Plan: for each job_alert_events row not yet planned, call
//      plan_alert_deliveries() which scores matching alerts, applies the
//      employer's tier reach budget (+ any paid top-up), and enqueues one
//      alert_deliveries row per (alert, job) as mode='instant' (top-N,
//      ranked by match score) or mode='digest' (overflow).
//   2) Drain: send the WhatsApp + email legs for pending mode='instant' rows,
//      gated per candidate by claim_alert_slot() (the daily cap). A leg that
//      is capped or disabled is skipped, not retried; a leg that errors
//      increments `attempts` so the next run retries it, up to MAX_ATTEMPTS.
const PLAN_BATCH = 100;
const SEND_BATCH = 200;
const MAX_ATTEMPTS = 3;

type AlertRow = {
  query: { keyword?: string | null; city?: string | null } | null;
  frequency: string;
  email_enabled: boolean;
  whatsapp_enabled: boolean;
};
type JobRow = {
  id: string;
  title: string;
  city: string | null;
  min_salary: number | null;
  max_salary: number | null;
  salary_period: string | null;
  company_id: string;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const admin = createAdminClient();

  const { data: settings } = await admin
    .from("whatsapp_settings")
    .select("alert_v2_enabled")
    .limit(1)
    .maybeSingle();
  if (!settings?.alert_v2_enabled) {
    return new Response(JSON.stringify({ ok: true, v2Enabled: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 1) Plan deliveries for newly activated jobs.
  const { data: pendingJobs } = await admin
    .from("job_alert_events")
    .select("job_id")
    .is("planned_at", null)
    .order("activated_at", { ascending: true })
    .limit(PLAN_BATCH);

  let planned = 0;
  for (const { job_id } of pendingJobs ?? []) {
    const { error } = await admin.rpc("plan_alert_deliveries", { _job_id: job_id });
    if (error) console.error("[alert-instant-notify] plan failed for", job_id, error.message);
    else planned++;
  }

  // Give up on rows that have exhausted their retries, so they don't linger
  // forever uncounted in "pending".
  await admin
    .from("alert_deliveries")
    .update({ status: "failed" })
    .eq("mode", "instant")
    .eq("status", "pending")
    .gte("attempts", MAX_ATTEMPTS);

  // 2) Drain pending instant deliveries.
  const { data: rows, error: rowsErr } = await admin
    .from("alert_deliveries")
    .select(
      "id, alert_id, user_id, job_id, attempts, candidate_job_alerts!inner(query, frequency, email_enabled, whatsapp_enabled), jobs!inner(id, title, city, min_salary, max_salary, salary_period, company_id)",
    )
    .eq("mode", "instant")
    .eq("status", "pending")
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(SEND_BATCH);

  if (rowsErr) {
    console.error("[alert-instant-notify] failed to load pending deliveries", rowsErr);
    return new Response(JSON.stringify({ ok: true, planned, sent: 0, skipped: 0, failed: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows ?? []) {
    const alert = row.candidate_job_alerts as unknown as AlertRow;
    const job = row.jobs as unknown as JobRow;
    const query = alert.query ?? {};

    const { data: profile } = await admin
      .from("profiles")
      .select("email, full_name")
      .eq("id", row.user_id)
      .maybeSingle();

    let anySent = false;
    let anyError: string | undefined;

    if (alert.whatsapp_enabled) {
      const { data: allowed } = await admin.rpc("claim_alert_slot", {
        _user: row.user_id,
        _channel: "whatsapp",
      });
      if (allowed) {
        const { data: company } = await admin
          .from("companies")
          .select("name")
          .eq("id", job.company_id)
          .maybeSingle();
        const result = await sendWhatsappForEvent(admin, {
          userId: row.user_id,
          templateKey: "job_alert_instant",
          variables: [
            profile?.full_name ?? "there",
            job.title,
            company?.name ?? "a company",
            job.city ?? "your area",
          ],
          source: "alert_instant",
          reference: { alert_id: row.alert_id, job_id: job.id },
          dedupeKey: `alert:${row.alert_id}:${job.id}`,
        });
        if (result.sent) anySent = true;
        else if (result.reason && result.reason !== "not_eligible" && result.reason !== "no_number")
          anyError = result.reason;
      }
    }

    if (alert.email_enabled && profile?.email) {
      const { data: allowed } = await admin.rpc("claim_alert_slot", {
        _user: row.user_id,
        _channel: "email",
      });
      if (allowed) {
        const prefs = await getCandidateEmailPrefs(admin, row.user_id);
        if (prefs.email_alerts) {
          const { data: company } = await admin
            .from("companies")
            .select("name")
            .eq("id", job.company_id)
            .maybeSingle();
          const matchedJob: MatchedJob = {
            id: job.id,
            title: job.title,
            city: job.city,
            min_salary: job.min_salary,
            max_salary: job.max_salary,
            salary_period: job.salary_period,
            company_name: company?.name ?? null,
          };
          const unsubToken = await signUnsubscribeToken(row.user_id);
          const unsubscribeUrl = unsubToken
            ? `${getPublicAppUrl()}/api/public/alerts-unsubscribe?u=${row.user_id}&t=${unsubToken}`
            : undefined;
          const { subject, html, text } = jobMatchEmail(
            { keyword: query.keyword, city: query.city, frequency: alert.frequency },
            [matchedJob],
            { unsubscribeUrl },
          );
          const result = await sendEmail({
            to: profile.email,
            subject,
            html,
            text,
            headers: unsubscribeUrl
              ? {
                  "List-Unsubscribe": `<${unsubscribeUrl}>`,
                  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                }
              : undefined,
          });
          if (result.ok) anySent = true;
          else anyError = result.error;
        }
      }
    }

    const nextStatus = anySent ? "sent" : anyError ? "pending" : "skipped";
    await admin
      .from("alert_deliveries")
      .update({
        status: nextStatus,
        attempts: row.attempts + (anyError ? 1 : 0),
        error: anyError ?? null,
        sent_at: anySent ? new Date().toISOString() : null,
      })
      .eq("id", row.id);

    if (anySent) {
      sent++;
      await admin
        .from("candidate_job_alerts")
        .update({ last_sent_at: new Date().toISOString() })
        .eq("id", row.alert_id);
    } else if (anyError) failed++;
    else skipped++;
  }

  return new Response(JSON.stringify({ ok: true, planned, sent, skipped, failed }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
