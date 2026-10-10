import { createClient } from "npm:@supabase/supabase-js@2";
import { createAdminClient } from "../_shared/supabaseAdmin.ts";
import { isValidGstin, lookupGstin } from "../_shared/gst.ts";
import { CORS_HEADERS, handleCorsPreflight } from "../_shared/cors.ts";

// Instant GST verification. Called from the employer KYC page with the caller's
// JWT. Only a super_admin or hr_admin of the company may run it. The lookup
// runs server-side, so the browser never sees the API key and can't mark a
// company verified by itself.
//
// Outcomes:
//   Active GSTIN found        -> verification row with status 'verified', company verified
//   Found but not Active      -> pending row for manual review, with the status noted
//   Lookup unavailable/failed -> pending row for manual review (never blocks the employer)
Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });

  let companyId: string | undefined;
  let gstin: string | undefined;
  let notes: string | undefined;
  try {
    ({ companyId, gstin, notes } = await req.json());
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!companyId || !gstin) return json({ error: "companyId and gstin required" }, 400);
  gstin = gstin.trim().toUpperCase();

  const authHeader = req.headers.get("Authorization") ?? "";
  const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await anon.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("employer_members")
    .select("role")
    .eq("company_id", companyId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!membership || !["super_admin", "hr_admin"].includes(membership.role as string))
    return json({ error: "insufficient_permissions" }, 403);

  if (!isValidGstin(gstin)) return json({ verified: false, error: "GSTIN format is invalid." }, 400);

  // De-dupe: don't call the external registry again for a GSTIN this company
  // already checked. An already-verified row means the company is verified
  // (make sure companies.is_verified reflects that, in case it was somehow
  // missed) — and a very recent pending row means the last check is still
  // "in flight" from the employer's perspective, so avoid a duplicate queue
  // entry and a duplicate API call for a double-click/resubmit.
  const { data: existing } = await admin
    .from("company_verifications")
    .select("status, created_at, notes")
    .eq("company_id", companyId)
    .eq("method", "gst")
    .eq("reference", gstin)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.status === "verified") {
    await admin
      .from("companies")
      .update({ verification_status: "verified", is_verified: true, gst_number: gstin })
      .eq("id", companyId);
    return json({ verified: true, alreadyVerified: true });
  }

  const PENDING_DEDUPE_WINDOW_MS = 10 * 60 * 1000;
  if (
    existing?.status === "pending" &&
    Date.now() - new Date(existing.created_at).getTime() < PENDING_DEDUPE_WINDOW_MS
  ) {
    return json({ verified: false, pending: true, reason: "Already under review." });
  }

  const result = await lookupGstin(gstin);

  if (result.ok && result.status?.toLowerCase() === "active") {
    const note = [
      "Instant GST verification.",
      `Legal name: ${result.legalName ?? "n/a"}.`,
      result.tradeName ? `Trade name: ${result.tradeName}.` : null,
    ]
      .filter(Boolean)
      .join(" ");

    const { error: insErr } = await admin.from("company_verifications").insert({
      company_id: companyId,
      method: "gst",
      status: "verified",
      reference: gstin,
      notes: notes?.trim() || note,
      docs: [],
      submitted_by: user.id,
      reviewed_at: new Date().toISOString(),
    });
    if (insErr) return json({ error: insErr.message }, 500);

    await admin
      .from("companies")
      .update({ verification_status: "verified", is_verified: true, gst_number: gstin })
      .eq("id", companyId);

    return json({ verified: true, legalName: result.legalName, status: result.status });
  }

  // Anything else goes to the manual queue, with the reason recorded so the
  // admin can see why it wasn't auto-verified.
  const reason = result.ok
    ? `GST status: ${result.status ?? "unknown"}.`
    : result.reason === "not_found"
      ? "GSTIN not found in the GST registry."
      : result.reason === "invalid_format"
        ? "GSTIN format is invalid."
        : result.reason === "not_configured"
          ? "Instant check not configured yet."
          : "Instant check unavailable.";

  const { error: pendErr } = await admin.from("company_verifications").insert({
    company_id: companyId,
    method: "gst",
    status: "pending",
    reference: gstin,
    notes: [notes?.trim(), reason].filter(Boolean).join(" "),
    docs: [],
    submitted_by: user.id,
  });
  if (pendErr) return json({ error: pendErr.message }, 500);

  return json({ verified: false, pending: true, reason });
});
