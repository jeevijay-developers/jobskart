import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";

// One-click unsubscribe for job-alert emails (RFC 8058 List-Unsubscribe).
// Token is a deterministic HMAC-SHA256(user_id) signed in
// supabase/functions/_shared/unsubscribeToken.ts using the SAME
// ALERT_UNSUBSCRIBE_SECRET value (set separately in this app's env and via
// `supabase secrets set` for the Edge Functions runtime — Deno.env and
// process.env don't share a store). No expiry: unsubscribing from alert
// emails is reversible and low-stakes, so there's nothing to protect by
// timing the link out.
//
// GET serves the human-facing click from the email; POST handles mail
// clients (Gmail, etc.) that implement List-Unsubscribe-Post and fire the
// unsubscribe directly with no page visit. Both perform the same action.
function verifyToken(secret: string, userId: string, token: string): boolean {
  const expected = Buffer.from(createHmac("sha256", secret).update(userId).digest("hex"));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

async function unsubscribe(userId: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: profile } = await supabaseAdmin
    .from("candidate_profiles")
    .select("notification_prefs")
    .eq("user_id", userId)
    .maybeSingle();
  const prefs = (profile?.notification_prefs as Record<string, unknown> | null) ?? {};
  const { error } = await supabaseAdmin
    .from("candidate_profiles")
    .update({ notification_prefs: { ...prefs, email_alerts: false } } as never)
    .eq("user_id", userId);
  return !error;
}

function htmlPage(message: string, ok: boolean) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>JobsKart</title></head>` +
      `<body style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:64px auto;text-align:center;color:#111827;">` +
      `<p style="font-size:16px;">${message}</p></body></html>`,
    { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export const Route = createFileRoute("/api/public/alerts-unsubscribe")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env.ALERT_UNSUBSCRIBE_SECRET;
        if (!secret) return new Response("Not configured", { status: 503 });
        const url = new URL(request.url);
        const userId = url.searchParams.get("u");
        const token = url.searchParams.get("t");
        if (!userId || !token) return htmlPage("Missing or invalid unsubscribe link.", false);
        if (!verifyToken(secret, userId, token))
          return htmlPage("This unsubscribe link is invalid.", false);
        const ok = await unsubscribe(userId);
        return htmlPage(
          ok
            ? "You've been unsubscribed from job alert emails. You can re-enable them any time from your alerts page."
            : "Something went wrong. Please try again from your alerts page.",
          ok,
        );
      },
      POST: async ({ request }) => {
        const secret = process.env.ALERT_UNSUBSCRIBE_SECRET;
        if (!secret) return new Response("Not configured", { status: 503 });
        const url = new URL(request.url);
        const userId = url.searchParams.get("u");
        const token = url.searchParams.get("t");
        if (!userId || !token) return new Response("Missing params", { status: 400 });
        if (!verifyToken(secret, userId, token))
          return new Response("Invalid token", { status: 403 });
        const ok = await unsubscribe(userId);
        return new Response(ok ? "ok" : "error", { status: ok ? 200 : 500 });
      },
    },
  },
});
