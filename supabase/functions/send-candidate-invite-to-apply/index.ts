import { createClient } from "npm:@supabase/supabase-js@2";
import { createAdminClient } from "../_shared/supabaseAdmin.ts";
import { sendEmail, getPublicAppUrl } from "../_shared/resend.ts";
import { candidateInviteToApplyEmail } from "../_shared/templates.ts";
import { sendWhatsappForEvent } from "../_shared/notify.ts";
import { CORS_HEADERS, handleCorsPreflight } from "../_shared/cors.ts";

// Called from the inviteCandidateToApply server fn (src/lib/credits.functions.ts)
// right after invite_candidate_to_apply() has already charged credits (or
// confirmed a free resend) and written the candidate_invites row. This
// function only dispatches — it never touches credits. Requires the caller's
// JWT (the end-user's, not service-role) and checks company membership on
// the job so one employer can't trigger invite sends for another company's job.
// Both channels are best-effort and independent (CLAUDE.md: no third-party
// failure blocks a core flow) — the caller decides whether a total failure
// (both false) warrants a refund.
Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });

  let jobId: string | undefined;
  let candidateUserId: string | undefined;
  let inviteId: string | undefined;
  try {
    ({ jobId, candidateUserId, inviteId } = await req.json());
  } catch {
    return new Response("Invalid JSON", { status: 400, headers: CORS_HEADERS });
  }
  if (!jobId || !candidateUserId || !inviteId)
    return new Response("jobId, candidateUserId and inviteId required", {
      status: 400,
      headers: CORS_HEADERS,
    });

  const authHeader = req.headers.get("Authorization") ?? "";
  const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await anon.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });

  const admin = createAdminClient();
  const { data: job, error: jobError } = await admin
    .from("jobs")
    .select("id, title, company_id, companies (name)")
    .eq("id", jobId)
    .maybeSingle();
  if (jobError || !job) return new Response("Not found", { status: 404, headers: CORS_HEADERS });

  const { data: isMember } = await anon.rpc("has_company_membership", {
    _user_id: user.id,
    _company_id: job.company_id,
  });
  if (!isMember) return new Response("Forbidden", { status: 403, headers: CORS_HEADERS });

  const { data: profile } = await admin
    .from("profiles")
    .select("email, full_name")
    .eq("id", candidateUserId)
    .maybeSingle();

  const companyName = job.companies?.name ?? "An employer";
  const jobUrl = `${getPublicAppUrl()}/jobs/${jobId}`;

  let emailSent = false;
  if (profile?.email) {
    const { subject, html, text } = candidateInviteToApplyEmail({
      candidateName: profile.full_name ?? null,
      jobTitle: job.title,
      companyName,
      jobUrl,
    });
    const result = await sendEmail({ to: profile.email, subject, html, text });
    emailSent = result.ok;
  }

  // No dedupeKey: each "Invite to Apply" click (including a free resend) is
  // its own distinct candidate-initiated action and should attempt its own
  // send — the per-recipient daily cap inside sendWhatsappForEvent is what
  // protects against abuse, not dedup against the (stable, reused) invite_id.
  const whatsappResult = await sendWhatsappForEvent(admin, {
    userId: candidateUserId,
    templateKey: "invite_to_apply",
    variables: [profile?.full_name ?? "there", job.title, companyName],
    source: "employer_invite_to_apply",
    reference: { job_id: jobId, invite_id: inviteId },
  });

  return new Response(JSON.stringify({ emailSent, whatsappSent: whatsappResult.sent }), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
