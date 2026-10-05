import { createAdminClient } from "../_shared/supabaseAdmin.ts";
import { sendEmail } from "../_shared/resend.ts";
import { sendTemplate } from "../_shared/whatsapp.ts";

// Invoked daily at 09:00 UTC by the 'job-expiry-reminders' pg_cron schedule
// (see migration 20260924120000_job_expiry_renewal.sql). claim_due_expiry_
// reminders() atomically claims one reminder per (job, threshold) so cron
// retries never double-notify.

type ClaimRow = {
  job_id: string;
  company_id: string;
  title: string;
  expires_at: string;
  threshold_days: number;
  auto_renew: boolean;
};

const DAY_MS = 86_400_000;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_due_expiry_reminders");
  if (error) {
    console.error("[job-expiry-reminders] claim failed", error);
    return new Response("ok", { status: 200 });
  }

  const claimed = (data ?? []) as ClaimRow[];
  let sent = 0;

  for (const row of claimed) {
    const daysLeft = Math.max(
      1,
      Math.ceil((new Date(row.expires_at).getTime() - Date.now()) / DAY_MS),
    );
    const action = row.auto_renew
      ? "Auto-renew is ON — this job will renew itself when it expires."
      : "Renew now to keep it live without a gap, or enable auto-renew.";

    const body = `"${row.title}" expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"} (${new Date(row.expires_at).toLocaleDateString("en-IN", { dateStyle: "medium" })}). ${action}`;

    const { data: members } = await admin
      .from("employer_members")
      .select("user_id")
      .eq("company_id", row.company_id)
      .in("role", ["super_admin", "hr_admin"]);
    const userIds = (members ?? []).map((m: { user_id: string }) => m.user_id);
    if (userIds.length > 0) {
      await admin.from("notifications").insert(
        userIds.map((uid: string) => ({
          user_id: uid,
          type: "job.expiring_soon",
          title: `"${row.title}" expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
          body,
          link: "/employer/jobs",
        })),
      );
    }

    // D10/D9: employer WhatsApp, independent of the email leg above — every
    // eligible admin/hr_admin on this company gets it, not just the first
    // one with an email (email intentionally only notifies one recipient).
    if (userIds.length > 0) {
      const { data: waMembers } = await admin
        .from("employer_members")
        .select("user_id, whatsapp_number")
        .eq("company_id", row.company_id)
        .in("user_id", userIds)
        .eq("whatsapp_opt_in", true)
        .not("whatsapp_number", "is", null);
      const { data: template } = await admin
        .from("whatsapp_templates")
        .select("provider_template_id, language, status")
        .eq("key", "job_expiry_reminder")
        .maybeSingle();
      if (template && template.status !== "paused") {
        for (const m of (waMembers ?? []) as Array<{ user_id: string; whatsapp_number: string }>) {
          const { error: capError } = await admin.rpc("register_whatsapp_send_for", {
            _user: m.user_id,
            _count: 1,
          });
          if (capError) continue;
          const result = await sendTemplate({
            to: m.whatsapp_number,
            templateName: template.provider_template_id,
            languageCode: template.language,
            variables: [row.title, String(daysLeft)],
          });
          await admin.from("whatsapp_messages").insert({
            recipient_user: m.user_id,
            recipient_number: m.whatsapp_number,
            template_key: "job_expiry_reminder",
            category: "utility",
            variables: [row.title, daysLeft],
            source: "job_expiry_reminder",
            reference: { job_id: row.job_id, company_id: row.company_id },
            status: result.ok ? "sent" : "failed",
            status_detail: result.ok ? null : result.error,
            sent_at: result.ok ? new Date().toISOString() : null,
            failed_at: result.ok ? null : new Date().toISOString(),
            provider_message_id: result.ok ? result.providerMessageId : null,
            attempts: 1,
          });
        }
      }
    }

    const { data: emails } = await admin
      .from("profiles")
      .select("email")
      .in("id", userIds)
      .limit(1);
    const to = (emails ?? [])[0]?.email as string | undefined;
    if (to) {
      await sendEmail({
        to,
        subject: `"${row.title}" expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
        html: `<p>${body}</p><p><a href="${Deno.env.get("PUBLIC_APP_URL") || "http://localhost:3000"}/employer/jobs">Renew now</a></p>`,
        text: body,
      });
    }
    sent += 1;
  }

  return Response.json({ sent });
});
