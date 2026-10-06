import { createAdminClient } from "../_shared/supabaseAdmin.ts";
import { sendEmail } from "../_shared/resend.ts";
import { getCandidateEmailPrefs } from "../_shared/notificationPrefs.ts";
import { applicationReceivedEmail } from "../_shared/templates.ts";
import { CORS_HEADERS, handleCorsPreflight } from "../_shared/cors.ts";

// Called ONLY from the tg_applications_after_insert() trigger via pg_net
// (see supabase/migrations/*_application_received_email.sql), never from the
// browser. The trigger sends the service-role key as the bearer, so this
// function accepts only that exact key — the browser has no way to call it
// for an arbitrary application.
Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!serviceKey || bearer !== serviceKey)
    return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });

  let applicationId: string | undefined;
  try {
    ({ applicationId } = await req.json());
  } catch {
    return new Response("Invalid JSON", { status: 400, headers: CORS_HEADERS });
  }
  if (!applicationId)
    return new Response("applicationId required", { status: 400, headers: CORS_HEADERS });

  const admin = createAdminClient();
  const { data: application, error } = await admin
    .from("applications")
    .select(
      "id, candidate_id, jobs (title, companies (name)), profiles!candidate_id (email, full_name)",
    )
    .eq("id", applicationId)
    .maybeSingle();
  if (error || !application)
    return new Response("Not found", { status: 404, headers: CORS_HEADERS });

  const email = application.profiles?.email;
  if (!email)
    return new Response(JSON.stringify({ ok: true, skipped: "no_email" }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });

  const prefs = await getCandidateEmailPrefs(admin, application.candidate_id);
  if (!prefs.email_alerts)
    return new Response(JSON.stringify({ ok: true, skipped: "email_alerts_disabled" }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });

  const { subject, html, text } = applicationReceivedEmail({
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
