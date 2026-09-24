import { createAdminClient } from "../_shared/supabaseAdmin.ts";
import { sendEmail } from "../_shared/resend.ts";

// Invoked hourly by the 'job-expiry-sweep' pg_cron schedule (see migration
// 20260924120000_job_expiry_renewal.sql) via net.http_post with the
// service-role key — same wiring as alert-digest / interview-reminder.
//
// All state transitions happen inside process_job_expiry_batch() (idempotent,
// row-locked). This function only fans out notifications for what the batch
// changed: in-app notifications to the company's super_admin/hr_admin members
// plus one email per affected company.

type BatchRow = {
  job_id: string;
  company_id: string;
  title: string;
  expires_at?: string;
  applications_count?: number;
};

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
        link: "/employer/jobs",
      })),
    );
  }

  const { data: emails } = await admin.from("profiles").select("email").in("id", userIds).limit(1);
  const to = (emails ?? [])[0]?.email as string | undefined;
  if (to) {
    await sendEmail({
      to,
      subject: note.title,
      html: `<p>${note.body}</p><p><a href="${Deno.env.get("PUBLIC_APP_URL") || "http://localhost:3000"}/employer/jobs">Manage your jobs</a></p>`,
      text: `${note.body} — manage your jobs at /employer/jobs`,
    });
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("process_job_expiry_batch");
  if (error) {
    console.error("[job-expiry-sweep] batch failed", error);
    return new Response("ok", { status: 200 });
  }

  const result = (data ?? { renewed: [], expired: [] }) as {
    renewed: BatchRow[];
    expired: BatchRow[];
  };

  for (const row of result.renewed ?? []) {
    await notifyCompany(admin, row.company_id, {
      type: "job.auto_renewed",
      title: `"${row.title}" was auto-renewed`,
      body: `Auto-renew extended "${row.title}" until ${new Date(row.expires_at!).toLocaleDateString("en-IN", { dateStyle: "medium" })}. No action needed.`,
    });
  }

  for (const row of result.expired ?? []) {
    const lockDate = row.expires_at
      ? new Date(new Date(row.expires_at).getTime() + 7 * 86400000).toLocaleDateString("en-IN", {
          dateStyle: "medium",
        })
      : null;
    const purgeDate = row.expires_at
      ? new Date(new Date(row.expires_at).getTime() + 60 * 86400000).toLocaleDateString("en-IN", {
          dateStyle: "medium",
        })
      : null;
    const retentionNote =
      lockDate && purgeDate
        ? ` Responses stay downloadable until ${lockDate} and are permanently removed on ${purgeDate}.`
        : "";
    await notifyCompany(admin, row.company_id, {
      type: "job.expired",
      title: `"${row.title}" has expired`,
      body: `The job is now hidden from search. ${row.applications_count ?? 0} candidate response(s) stay available — renew to relist the job and keep your pipeline.${retentionNote}`,
    });
  }

  return Response.json({
    renewed: (result.renewed ?? []).length,
    expired: (result.expired ?? []).length,
  });
});
