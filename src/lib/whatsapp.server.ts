// Node-side counterpart to supabase/functions/_shared/whatsapp.ts. That module
// is Deno-only (Deno.env, imported by Supabase Edge Functions); this one runs
// inside the TanStack Start server (Node), for the one case that needs to send
// from here instead of an edge function: an immediate reply from the public
// webhook route (src/routes/api/public/webhooks/whatsapp.ts) to a STOP keyword.
// Same secrets, same Graph API — kept as a separate file only because the two
// runtimes can't share a module (no `Deno` global in Node, no `process.env`
// guarantee in Deno).

const GRAPH_API_VERSION = "v21.0";

export function isWhatsappConfigured(): boolean {
  return !!(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

export async function sendWhatsappText(opts: {
  to: string; // E.164, e.g. +919876543210
  body: string;
}): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    console.error("[whatsapp] WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set");
    return { ok: false, error: "WhatsApp provider not configured" };
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
    if (!res.ok) {
      const text = await res.text();
      console.error("[whatsapp] send failed", res.status, text);
      return { ok: false, error: `Graph API ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    console.error("[whatsapp] send threw", e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
