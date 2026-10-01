import { createClient } from "npm:@supabase/supabase-js@2";
import { createAdminClient } from "../_shared/supabaseAdmin.ts";
import { sendEmail, getPublicAppUrl } from "../_shared/resend.ts";
import { employerInviteEmail } from "../_shared/templates.ts";
import { CORS_HEADERS, handleCorsPreflight } from "../_shared/cors.ts";

// Called directly from the client (src/routes/_authenticated/employer/team.tsx)
// right after an employer_invites row is inserted (sendInvite) or its token is
// rotated (resendInvite) — fire-and-forget, same pattern as
// send-alert-confirmation. Requires the caller's JWT and checks company
// membership on the invite's company so one employer can't trigger invite
// emails for another company.
Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });

  let inviteId: string | undefined;
  try {
    ({ inviteId } = await req.json());
  } catch {
    return new Response("Invalid JSON", { status: 400, headers: CORS_HEADERS });
  }
  if (!inviteId) return new Response("inviteId required", { status: 400, headers: CORS_HEADERS });

  const authHeader = req.headers.get("Authorization") ?? "";
  const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await anon.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });

  const admin = createAdminClient();
  const { data: invite, error } = await admin
    .from("employer_invites")
    .select("id, email, role, token, expires_at, company_id, invited_by, accepted_at, companies (name)")
    .eq("id", inviteId)
    .maybeSingle();
  if (error || !invite) return new Response("Not found", { status: 404, headers: CORS_HEADERS });

  const { data: isMember } = await anon.rpc("has_company_membership", {
    _user_id: user.id,
    _company_id: invite.company_id,
  });
  if (!isMember) return new Response("Forbidden", { status: 403, headers: CORS_HEADERS });

  if (invite.accepted_at)
    return new Response(JSON.stringify({ ok: true, skipped: "already_accepted" }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });

  const { data: inviter } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", invite.invited_by)
    .maybeSingle();

  // Prefer the Origin the admin's own browser sent this request from — that's
  // the exact URL they're actually reachable at (dev LAN IP, localhost,
  // staging, prod), guaranteed in sync with where they tested from. Only fall
  // back to the PUBLIC_APP_URL secret (which can go stale/unset) when Origin
  // is missing, e.g. a server-to-server call.
  const origin = req.headers.get("Origin");
  const appBase = (origin || getPublicAppUrl()).replace(/\/+$/, "");
  const acceptUrl = appBase + "/invite/" + invite.token;
  const { subject, html, text } = employerInviteEmail({
    companyName: invite.companies?.name ?? "a company",
    inviterName: inviter?.full_name ?? null,
    role: invite.role as "recruiter" | "hr_admin" | "super_admin",
    acceptUrl,
    expiresAtIso: invite.expires_at,
  });

  const result = await sendEmail({ to: invite.email, subject, html, text });
  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 502,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
