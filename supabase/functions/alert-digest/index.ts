import { createAdminClient } from "../_shared/supabaseAdmin.ts";
import { sendEmail } from "../_shared/resend.ts";
import { jobMatchEmail, type MatchedJob } from "../_shared/templates.ts";
import { getCandidateEmailPrefs } from "../_shared/notificationPrefs.ts";
import { sendWhatsappForEvent } from "../_shared/notify.ts";
import { signUnsubscribeToken } from "../_shared/unsubscribeToken.ts";
import { getPublicAppUrl } from "../_shared/resend.ts";

type Frequency = "daily" | "weekly";
const MAX_ATTEMPTS = 3;

type AlertRow = { frequency: string; email_enabled: boolean; whatsapp_enabled: boolean };
type JobRow = {
  id: string;
  title: string;
  city: string | null;
  min_salary: number | null;
  max_salary: number | null;
  salary_period: string | null;
  companies: { name: string } | null;
};
type DeliveryRow = {
  id: string;
  alert_id: string;
  user_id: string;
  score: number;
  attempts: number;
  candidate_job_alerts: AlertRow;
  jobs: JobRow;
};

// v2: invoked by the same two pg_cron schedules as before (alert-digest-daily,
// alert-digest-weekly). Reworked to read the alert_deliveries queue (written
// by plan_alert_deliveries() off the DB-side activation trigger) instead of
// re-scanning every job by created_at — that query missed jobs activated
// from a draft after creation, and scanning in memory didn't scale.
//
// The other behavioral change: one merged email + one merged WhatsApp ping
// per CANDIDATE per run, not one per alert. A candidate with 3 overlapping
// alerts used to get 3 separate digest emails for the same jobs; rows are
// now grouped by user_id, deduped by job and capped at alert_digest_max_jobs,
// ranked by match score.
//
// The daily run also drains instant-frequency rows that overflowed their
// job's tier reach budget (plan_alert_deliveries downgrades overflow to
// mode='digest' regardless of the alert's own frequency) — those candidates
// still hear about the job, just via email instead of an instant push. The
// weekly run only processes alerts whose own frequency is 'weekly', so that
// overflow isn't counted into both a daily and a weekly email.
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
  const { data: settings } = await admin
    .from("whatsapp_settings")
    .select("alert_v2_enabled, alert_digest_max_jobs")
    .limit(1)
    .maybeSingle();
  if (!settings?.alert_v2_enabled) {
    return new Response(JSON.stringify({ ok: true, v2Enabled: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  const maxJobs = settings.alert_digest_max_jobs ?? 10;

  await admin
    .from("alert_deliveries")
    .update({ status: "failed" })
    .eq("mode", "digest")
    .eq("status", "pending")
    .gte("attempts", MAX_ATTEMPTS);

  const { data: rows, error: rowsErr } = await admin
    .from("alert_deliveries")
    .select(
      "id, alert_id, user_id, score, attempts, candidate_job_alerts!inner(frequency, email_enabled, whatsapp_enabled), jobs!inner(id, title, city, min_salary, max_salary, salary_period, companies(name))",
    )
    .eq("mode", "digest")
    .eq("status", "pending")
    .lt("attempts", MAX_ATTEMPTS)
    .order("score", { ascending: false });

  if (rowsErr) {
    console.error("[alert-digest] failed to load pending deliveries", rowsErr);
    return new Response("ok", { status: 200 });
  }

  // Daily: everything except alerts whose own frequency is 'weekly' (so
  // 'daily' alerts and 'instant' overflow go out same-day). Weekly: only
  // alerts whose own frequency is 'weekly' — otherwise instant overflow
  // would double up into both a daily and a weekly email.
  const eligible = ((rows ?? []) as unknown as DeliveryRow[]).filter((r) =>
    frequency === "daily"
      ? r.candidate_job_alerts.frequency !== "weekly"
      : r.candidate_job_alerts.frequency === "weekly",
  );

  const byUser = new Map<string, DeliveryRow[]>();
  for (const row of eligible) {
    const list = byUser.get(row.user_id) ?? [];
    list.push(row);
    byUser.set(row.user_id, list);
  }

  let emailsSent = 0;
  let waSent = 0;
  let candidatesSkipped = 0;

  for (const [userId, userRows] of byUser) {
    const { data: profile } = await admin
      .from("profiles")
      .select("email, full_name")
      .eq("id", userId)
      .maybeSingle();

    const wantsEmail = userRows.some((r) => r.candidate_job_alerts.email_enabled);
    const wantsWa = userRows.some((r) => r.candidate_job_alerts.whatsapp_enabled);

    // Dedup by job (multiple alerts can match the same job) before capping.
    const byJob = new Map<string, DeliveryRow>();
    for (const r of userRows) if (!byJob.has(r.jobs.id)) byJob.set(r.jobs.id, r);
    const uniqueRows = [...byJob.values()].sort((a, b) => b.score - a.score);
    const top = uniqueRows.slice(0, maxJobs);
    const matchedJobs: MatchedJob[] = top.map((r) => ({
      id: r.jobs.id,
      title: r.jobs.title,
      city: r.jobs.city,
      min_salary: r.jobs.min_salary,
      max_salary: r.jobs.max_salary,
      salary_period: r.jobs.salary_period,
      company_name: r.jobs.companies?.name ?? null,
    }));

    let anyEmailSent = false;
    let emailError: string | undefined;
    if (wantsEmail && profile?.email && matchedJobs.length > 0) {
      const prefs = await getCandidateEmailPrefs(admin, userId);
      const prefAllows = frequency === "weekly" ? prefs.weekly_digest : prefs.email_alerts;
      if (prefAllows) {
        const { data: allowed } = await admin.rpc("claim_alert_slot", {
          _user: userId,
          _channel: "email",
        });
        if (allowed) {
          const unsubToken = await signUnsubscribeToken(userId);
          const unsubscribeUrl = unsubToken
            ? `${getPublicAppUrl()}/api/public/alerts-unsubscribe?u=${userId}&t=${unsubToken}`
            : undefined;
          const { subject, html, text } = jobMatchEmail(
            { keyword: null, city: null, frequency },
            matchedJobs,
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
          if (result.ok) {
            anyEmailSent = true;
            emailsSent++;
          } else {
            emailError = result.error;
            console.error("[alert-digest] send failed for user", userId, result.error);
          }
        }
      }
    }

    let anyWaSent = false;
    if (wantsWa) {
      const { data: allowed } = await admin.rpc("claim_alert_slot", {
        _user: userId,
        _channel: "whatsapp",
      });
      if (allowed) {
        const today = new Date().toISOString().slice(0, 10);
        const result = await sendWhatsappForEvent(admin, {
          userId,
          templateKey: "job_alert_digest",
          variables: [profile?.full_name ?? "there", uniqueRows.length],
          source: "alert_digest",
          reference: { frequency },
          dedupeKey: `alertdigest:${userId}:${frequency}:${today}`,
        });
        if (result.sent) {
          anyWaSent = true;
          waSent++;
        }
      }
    }

    const resolvedIds = userRows.map((r) => r.id);
    if (anyEmailSent || anyWaSent) {
      await admin
        .from("alert_deliveries")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .in("id", resolvedIds);
      await admin
        .from("candidate_job_alerts")
        .update({ last_sent_at: new Date().toISOString() })
        .in("id", [...new Set(userRows.map((r) => r.alert_id))]);
    } else if (emailError) {
      for (const r of userRows) {
        await admin
          .from("alert_deliveries")
          .update({ attempts: r.attempts + 1, error: emailError })
          .eq("id", r.id);
      }
    } else {
      // Neither channel wanted/allowed (opted out, capped, or no email on
      // file) — nothing to send; mark skipped so it doesn't linger forever.
      await admin.from("alert_deliveries").update({ status: "skipped" }).in("id", resolvedIds);
      candidatesSkipped++;
    }
  }

  return new Response(
    JSON.stringify({ ok: true, candidates: byUser.size, emailsSent, waSent, candidatesSkipped }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
