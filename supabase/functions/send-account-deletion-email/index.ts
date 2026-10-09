import { createClient } from "npm:@supabase/supabase-js@2";
import { createAdminClient } from "../_shared/supabaseAdmin.ts";
import { sendEmail, getPublicAppUrl } from "../_shared/resend.ts";
import { accountDeletionEmail } from "../_shared/templates.ts";
import { CORS_HEADERS, handleCorsPreflight } from "../_shared/cors.ts";

// Called directly from the client (src/components/candidate/DeleteAccountDialog.tsx)
// right after the candidate creates a deletion request via the
// request_account_deletion() RPC. Requires the caller's JWT and additionally
// checks that the JWT's user owns the request being emailed, so one candidate
// can't trigger a deletion email for another account.
Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });

  let requestId: string | undefined;
  try {
    ({ requestId } = await req.json());
  } catch {
    return new Response("Invalid JSON", { status: 400, headers: CORS_HEADERS });
  }
  if (!requestId) return new Response("requestId required", { status: 400, headers: CORS_HEADERS });

  const authHeader = req.headers.get("Authorization") ?? "";
  const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await anon.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });

  const admin = createAdminClient();
  const { data: reqRow, error } = await admin
    .from("candidate_deletion_requests")
    .select("id, user_id, token, confirmed_at")
    .eq("id", requestId)
    .maybeSingle();

  if (error || !reqRow || reqRow.user_id !== user.id) {
    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  }
  if (reqRow.confirmed_at) {
    return new Response("Already confirmed", { status: 409, headers: CORS_HEADERS });
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("email")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.email)
    return new Response("No email on file", { status: 400, headers: CORS_HEADERS });

  const confirmUrl = `${getPublicAppUrl()}/delete-account/${reqRow.token}`;
  const { subject, html, text } = accountDeletionEmail({ confirmUrl });

  const result = await sendEmail({ to: profile.email, subject, html, text });
  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 502,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
