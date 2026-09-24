import { createAdminClient } from "../_shared/supabaseAdmin.ts";
import { sendEmail } from "../_shared/resend.ts";

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
