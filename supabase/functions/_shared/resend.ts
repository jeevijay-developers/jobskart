const RESEND_API_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "JobsKart <onboarding@resend.dev>";

export function getPublicAppUrl(): string {
  return (Deno.env.get("PUBLIC_APP_URL") || "http://localhost:3000").replace(/\/+$/, "");
}

/**
 * Sends one email via Resend's REST API. RESEND_API_KEY / RESEND_FROM_EMAIL
 * are read from Supabase secrets (Deno.env) — never from the app's .env,
 * since Edge Functions run on Supabase's infrastructure and can't see it.
 * Never throws: a Resend failure should not block the caller (job insert
 * webhook, cron digest, or alert creation) — errors are logged and reported
 * back via the return value instead.
 */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.error("[resend] RESEND_API_KEY is not set");
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }
  const from = Deno.env.get("RESEND_FROM_EMAIL") || DEFAULT_FROM;

  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [opts.to], subject: opts.subject, html: opts.html, ...(opts.text ? { text: opts.text } : {}) }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error("[resend] send failed", res.status, body);
      return { ok: false, error: `Resend ${res.status}: ${body}` };
    }
    return { ok: true };
  } catch (e) {
    console.error("[resend] send threw", e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
