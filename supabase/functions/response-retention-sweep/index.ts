import { createAdminClient } from "../_shared/supabaseAdmin.ts";
import { sendEmail } from "../_shared/resend.ts";

// Invoked daily by the 'response-retention-sweep' pg_cron schedule (see
// migration 20260924150000_db_access_model.sql) via net.http_post with the
// service-role key — same wiring as job-expiry-sweep / interview-reminder.
//
// Two steps, both idempotent/row-locked in Postgres:
//   1. claim_due_purge_reminders() — jobs entering the T-7-before-purge
//      window that haven't been reminded yet, so employers get an export CTA.
//   2. purge_expired_responses() — the actual 60-day deletion of application
//      rows (cover notes, expected salary, employer notes). Candidate profile
//      data and jobs.applications_count are untouched.

type ReminderRow = { job_id: string; company_id: string; title: string; purge_at: string };
type PurgedRow = { job_id: string; company_id: string; title: string; purged_count: number };

async function notifyCompany(
  admin: ReturnType<typeof createAdminClient>,
  companyId: string,
  note: { type: string; title: string; body: string },
) {
  const { data: members } = await admin
    .from("employer_members")
    .select("user_id, role")
    .eq("company_id", companyId)
    .in("role", ["super_admin", "hr_admin"]);
  const userIds = (members ?? []).map((m: { user_id: string }) => m.user_id);
  if (userIds.length > 0) {
    await admin.from("notifications").insert(
      userIds.map((uid: string) => ({
        user_id: uid,
        type: note.type,
        title: note.title,
        body: note.body,
        link: "/employer/responses",
      })),
    );
  }

  const { data: emails } = await admin.from("profiles").select("email").in("id", userIds).limit(1);
  const to = (emails ?? [])[0]?.email as string | undefined;
  if (to) {
    await sendEmail({
      to,
      subject: note.title,
      html: `<p>${note.body}</p><p><a href="${Deno.env.get("PUBLIC_APP_URL") || "http://localhost:3000"}/employer/responses">Export responses</a></p>`,
      text: `${note.body} — export at /employer/responses`,
    });
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const admin = createAdminClient();

  const { data: reminders, error: remindErr } = await admin.rpc("claim_due_purge_reminders");
  if (remindErr) {
    console.error("[response-retention-sweep] claim_due_purge_reminders failed", remindErr);
  }
  for (const row of (reminders ?? []) as ReminderRow[]) {
    await notifyCompany(admin, row.company_id, {
      type: "responses.purge_warning",
      title: `Responses for "${row.title}" are removed in 7 days`,
      body: `Candidate responses for "${row.title}" will be permanently removed on ${new Date(row.purge_at).toLocaleDateString("en-IN", { dateStyle: "medium" })}. Export them now if you need to keep a copy.`,
    });
  }

  const { data: purgeResult, error: purgeErr } = await admin.rpc("purge_expired_responses");
  if (purgeErr) {
    console.error("[response-retention-sweep] purge_expired_responses failed", purgeErr);
    return new Response("ok", { status: 200 });
  }
  const purged = ((purgeResult ?? { purged: [] }) as { purged: PurgedRow[] }).purged ?? [];

  return Response.json({
    reminders_sent: (reminders ?? []).length,
    jobs_purged: purged.length,
    responses_purged: purged.reduce((sum, r) => sum + (r.purged_count ?? 0), 0),
  });
});
