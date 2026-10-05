/**
 * Meta WhatsApp Cloud API adapter (D1). Every outbound WhatsApp send in this
 * repo goes through sendTemplate() here — no other file should hold a
 * provider URL, so swapping to a BSP (Gupshup/Interakt) later is a change in
 * one file, not a grep-and-replace across edge functions.
 *
 * Secrets (set via `supabase secrets set`, never committed):
 *   WHATSAPP_ACCESS_TOKEN    — permanent/system-user token from Meta Business Manager
 *   WHATSAPP_PHONE_NUMBER_ID — the sending number's phone_number_id
 *   WHATSAPP_APP_SECRET      — app secret, used to verify inbound webhook signatures
 *   WHATSAPP_VERIFY_TOKEN    — arbitrary string you choose, used for the GET handshake
 *
 * None of these are set yet — sendTemplate() returns a clear "not configured"
 * error instead of throwing, so every call site already wired to it degrades
 * the same way the email channel does when RESEND_API_KEY is missing. Once
 * the real WABA credentials are added as Supabase secrets, sending starts
 * working with no code change.
 */

const GRAPH_API_VERSION = "v21.0";

export type WhatsappTemplateVariable = string | number;

export type SendTemplateResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; error: string; retryable: boolean };

/**
 * Sends one approved template message. `variables` are positional {{1}},
 * {{2}}... body parameters, in the order whatsapp_templates.variables lists
 * them for that template key — the caller (notify.ts fanout, Phase 3) is
 * responsible for ordering them to match what's approved in Meta's manager.
 */
export async function sendTemplate(opts: {
  to: string; // E.164, e.g. +919876543210
  templateName: string; // provider_template_id from whatsapp_templates
  languageCode?: string;
  variables?: WhatsappTemplateVariable[];
}): Promise<SendTemplateResult> {
  const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneNumberId) {
    console.error("[whatsapp] WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set");
    return { ok: false, error: "WhatsApp provider not configured", retryable: false };
  }

  const to = opts.to.replace(/^\+/, ""); // Graph API wants digits only, no leading +
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: opts.templateName,
      language: { code: opts.languageCode || "en" },
      ...(opts.variables?.length
        ? {
            components: [
              {
                type: "body",
                parameters: opts.variables.map((v) => ({ type: "text", text: String(v) })),
              },
            ],
          }
        : {}),
    },
  };

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const message = json?.error?.message || `Graph API ${res.status}`;
      console.error("[whatsapp] send failed", res.status, json);
      // Meta's error code 131026 = number not on WhatsApp, 131047 = re-engagement
      // window; both are permanent for this attempt, not worth retrying.
      const permanentCodes = new Set([131026, 131047, 131051]);
      const code = json?.error?.code as number | undefined;
      return { ok: false, error: message, retryable: code ? !permanentCodes.has(code) : true };
    }
    const providerMessageId = json?.messages?.[0]?.id;
    if (!providerMessageId) {
      return { ok: false, error: "No message id in provider response", retryable: true };
    }
    return { ok: true, providerMessageId };
  } catch (e) {
    console.error("[whatsapp] send threw", e);
    return { ok: false, error: e instanceof Error ? e.message : String(e), retryable: true };
  }
}

/** Sends a free-form text reply — only valid inside Meta's 24h customer-service
 * window (D8's STOP-keyword confirmation uses this, triggered by an inbound message). */
export async function sendText(opts: { to: string; body: string }): Promise<SendTemplateResult> {
  const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneNumberId) {
    return { ok: false, error: "WhatsApp provider not configured", retryable: false };
  }
  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: opts.to.replace(/^\+/, ""),
          type: "text",
          text: { body: opts.body },
        }),
      },
    );
    const json = await res.json().catch(() => null);
    if (!res.ok)
      return {
        ok: false,
        error: json?.error?.message || `Graph API ${res.status}`,
        retryable: true,
      };
    return { ok: true, providerMessageId: json?.messages?.[0]?.id ?? "" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), retryable: true };
  }
}

/**
 * Verifies Meta's `x-hub-signature-256` header (HMAC-SHA256 of the raw request
 * body, keyed by the app secret) before the webhook touches any data (D8).
 * Must be called with the RAW body string — never JSON.parse first and
 * re-stringify, since that can change byte-for-byte formatting and break the
 * signature.
 */
export async function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  const appSecret = Deno.env.get("WHATSAPP_APP_SECRET");
  if (!appSecret || !signatureHeader) return false;
  const expected = signatureHeader.replace(/^sha256=/, "");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computed = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time compare — both strings are always the same length (64 hex
  // chars) when valid, so this loop doesn't itself leak timing information.
  if (computed.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export function isWhatsappConfigured(): boolean {
  return !!(Deno.env.get("WHATSAPP_ACCESS_TOKEN") && Deno.env.get("WHATSAPP_PHONE_NUMBER_ID"));
}
