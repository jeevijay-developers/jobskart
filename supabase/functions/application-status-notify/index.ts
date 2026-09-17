import { createClient } from "npm:@supabase/supabase-js@2";
import { createAdminClient } from "../_shared/supabaseAdmin.ts";
import { sendEmail } from "../_shared/resend.ts";
import {
  applicationStatusEmail,
  type ApplicationStatusNotifyStatus,
} from "../_shared/templates.ts";
import { CORS_HEADERS, handleCorsPreflight } from "../_shared/cors.ts";

const NOTIFY_STATUSES = new Set<string>(["shortlisted", "interview", "rejected"]);

// Called directly from the client (src/routes/_authenticated/employer/responses.tsx)
// right after an employer's status-change mutation succeeds — fire-and-forget, same
// pattern as send-alert-confirmation, chosen over a Database Webhook so the email
// fires the instant the update commits rather than waiting on webhook delivery, and
// so the trigger stays visible in this repo instead of dashboard-only config.
// Requires the caller's JWT and checks company membership on the application's job
// so one employer can't fire notifications for another company's applications.
Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });

  let applicationId: string | undefined;
  let status: string | undefined;
  try {
    ({ applicationId, status } = await req.json());
  } catch {
    return new Response("Invalid JSON", { status: 400, headers: CORS_HEADERS });
  }
  if (!applicationId || !status) {
    return new Response("applicationId and status required", { status: 400, headers: CORS_HEADERS });
  }
  if (!NOTIFY_STATUSES.has(status))
    return new Response("ignored", { status: 200, headers: CORS_HEADERS });

  const authHeader = req.headers.get("Authorization") ?? "";
  const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await anon.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });

  const admin = createAdminClient();
  const { data: application, error } = await admin
    .from("applications")
    .select(
      "id, company_id, jobs (title, companies (name)), profiles!candidate_id (email, full_name)",
    )
    .eq("id", applicationId)
    .maybeSingle();
  if (error || !application) return new Response("Not found", { status: 404, headers: CORS_HEADERS });

  const { data: isMember } = await anon.rpc("has_company_membership", {
    _user_id: user.id,
    _company_id: application.company_id,
  });
  if (!isMember) return new Response("Forbidden", { status: 403, headers: CORS_HEADERS });

  const email = application.profiles?.email;
  if (!email)
    return new Response(JSON.stringify({ ok: true, skipped: "no_email" }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });

  const { subject, html, text } = applicationStatusEmail({
    status: status as ApplicationStatusNotifyStatus,
    candidateName: application.profiles?.full_name ?? null,
    jobTitle: application.jobs?.title ?? "the role",
    companyName: application.jobs?.companies?.name ?? null,
  });

  const result = await sendEmail({ to: email, subject, html, text });
  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 502,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
