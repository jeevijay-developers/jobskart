import { createAdminClient } from "../_shared/supabaseAdmin.ts";
import { sendEmail } from "../_shared/resend.ts";
import {
  verificationDecisionEmail,
  verificationSubmittedEmail,
} from "../_shared/templates.ts";
import { CORS_HEADERS, handleCorsPreflight } from "../_shared/cors.ts";

const METHOD_LABEL: Record<string, string> = {
  gst: "GST / PAN / CIN",
  email: "business email",
  manual: "manual KYC",
};

// Called ONLY from the company_verifications trigger via pg_net (see
// 20261005150000_verification_emails.sql), never from the browser. Accepts only
// the service-role key as bearer, same as application-received-notify.
Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!serviceKey || bearer !== serviceKey)
    return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });

  let verificationId: string | undefined;
  let event: string | undefined;
  try {
    ({ verificationId, event } = await req.json());
  } catch {
    return new Response("Invalid JSON", { status: 400, headers: CORS_HEADERS });
  }
  if (!verificationId || !event)
    return new Response("verificationId and event required", { status: 400, headers: CORS_HEADERS });

  const admin = createAdminClient();
  const { data: v, error } = await admin
    .from("company_verifications")
    .select("id, method, status, notes, submitted_by, companies (name, business_email)")
    .eq("id", verificationId)
    .maybeSingle();
  if (error || !v) return new Response("Not found", { status: 404, headers: CORS_HEADERS });

  // Recipients: the company's business email (entered at signup) and the login
  // email of whoever submitted, de-duplicated and skipping empty values.
  let submitterEmail: string | null = null;
  if (v.submitted_by) {
    const { data: p } = await admin.from("profiles").select("email").eq("id", v.submitted_by).maybeSingle();
    submitterEmail = p?.email ?? null;
  }
  const company = v.companies as { name: string | null; business_email: string | null } | null;
  const recipients = [...new Set([company?.business_email, submitterEmail].filter((e): e is string => !!e))];
  if (recipients.length === 0)
    return new Response(JSON.stringify({ ok: true, skipped: "no_recipients" }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });

  const methodLabel = METHOD_LABEL[v.method] ?? v.method;
  let mail: { subject: string; html: string; text: string };
  if (event === "submitted") {
    mail = verificationSubmittedEmail({ companyName: company?.name ?? null, methodLabel });
  } else if (event === "verified" || event === "rejected") {
    mail = verificationDecisionEmail({
      companyName: company?.name ?? null,
      methodLabel,
      status: event,
      reason: event === "rejected" ? v.notes ?? null : null,
    });
  } else {
    return new Response("Unknown event", { status: 400, headers: CORS_HEADERS });
  }

  const results = await Promise.all(recipients.map((to) => sendEmail({ to, ...mail })));
  const failed = results.filter((r) => !r.ok);
  return new Response(JSON.stringify({ ok: failed.length === 0, sent: results.length - failed.length, errors: failed.map((f) => f.error) }), {
    status: failed.length === 0 ? 200 : 502,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
