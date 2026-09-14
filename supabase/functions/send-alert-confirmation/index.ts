import { createClient } from "npm:@supabase/supabase-js@2";
import { createAdminClient } from "../_shared/supabaseAdmin.ts";
import { sendEmail } from "../_shared/resend.ts";
import { alertConfirmationEmail } from "../_shared/templates.ts";

// Called directly from the client (src/routes/_authenticated/candidate/alerts.tsx)
// right after a candidate creates a new alert — fire-and-forget, not tied to any
// digest/instant matching. Requires the caller's JWT (default `verify_jwt = true`
// deploy) and additionally checks that the JWT's user owns the alert being
// confirmed, so one candidate can't trigger a confirmation email for another's alert.
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let alertId: string | undefined;
  try {
    ({ alertId } = await req.json());
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (!alertId) return new Response("alertId required", { status: 400 });

  const authHeader = req.headers.get("Authorization") ?? "";
  const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await anon.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const admin = createAdminClient();
  const { data: alert, error } = await admin
    .from("candidate_job_alerts")
    .select("id, user_id, query, frequency")
    .eq("id", alertId)
    .maybeSingle();

  if (error || !alert || alert.user_id !== user.id) {
    return new Response("Not found", { status: 404 });
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("email")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.email) return new Response("No email on file", { status: 200 });

  const query = (alert.query ?? {}) as { keyword?: string | null; city?: string | null };
  const { subject, html, text } = alertConfirmationEmail({
    keyword: query.keyword,
    city: query.city,
    frequency: alert.frequency,
  });

  const result = await sendEmail({ to: profile.email, subject, html, text });
  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 502,
    headers: { "Content-Type": "application/json" },
  });
});
