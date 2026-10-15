import { createAdminClient } from "../_shared/supabaseAdmin.ts";
import { sendEmail, getPublicAppUrl } from "../_shared/resend.ts";

// Invoked every 5 minutes by the 'crm-task-reminders' pg_cron schedule
// (supabase/migrations/20260929090000_employer_crm_automation.sql) via
// net.http_post with the service-role key — same wiring as job-expiry-sweep.
//
// claim_due_crm_tasks() atomically claims overdue follow_up_tasks (flipping
// due_notified_at in the same UPDATE it reads from, so a retried/overlapping
// tick never double-notifies) but does not notify anyone itself — unlike
// crm_tick_automation()'s 'notify' action, which inserts its own
// notifications row. This function does that part: for each claimed task,
// notify the assignee, falling back to whoever created it, falling back to
// the company's admins (same fallback chain crm_tick_automation uses for its
// own company-wide alerts).

type ClaimedTask = {
  id: string;
  company_id: string;
  assignee_id: string | null;
  created_by: string | null;
  title: string;
  candidate_id: string | null;
  job_id: string | null;
  application_id: string | null;
  due_at: string;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_due_crm_tasks");
  if (error) {
    console.error("[crm-task-reminders] claim failed", error);
    return new Response("ok", { status: 200 });
  }

  const tasks = (data ?? []) as ClaimedTask[];
  let notified = 0;

  for (const task of tasks) {
    let userIds: string[] = [];
    if (task.assignee_id) userIds = [task.assignee_id];
    else if (task.created_by) userIds = [task.created_by];
    else {
      const { data: admins } = await admin
        .from("employer_members")
        .select("user_id")
        .eq("company_id", task.company_id)
        .in("role", ["super_admin", "hr_admin"]);
      userIds = (admins ?? []).map((m: { user_id: string }) => m.user_id);
    }
    if (userIds.length === 0) continue;

    const dueLabel = new Date(task.due_at).toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    });
    const title = `Follow-up due: ${task.title}`;
    const body = `"${task.title}" was due ${dueLabel}.`;

    try {
      await admin.from("notifications").insert(
        userIds.map((uid) => ({
          user_id: uid,
          type: "crm.task_due",
          title,
          body,
          link: "/employer/crm",
        })),
      );
      notified += userIds.length;

      const { data: emails } = await admin
        .from("profiles")
        .select("email")
        .in("id", userIds)
        .limit(1);
      const to = (emails ?? [])[0]?.email as string | undefined;
      if (to) {
        await sendEmail({
          to,
          subject: title,
          html: `<p>${body}</p><p><a href="${getPublicAppUrl()}/employer/crm">Open CRM</a></p>`,
          text: `${body} — open CRM at ${getPublicAppUrl()}/employer/crm`,
        });
      }
    } catch (e) {
      console.error("[crm-task-reminders] notify failed for task", task.id, e);
    }
  }

  return Response.json({ claimed: tasks.length, notified });
});
