import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";

// D8: Meta WhatsApp Cloud API status + inbound webhook. Separate endpoint from
// the Supabase-edge-function-side provider adapter (supabase/functions/_shared/whatsapp.ts)
// because this repo terminates all public webhooks as TanStack Start server
// routes (see razorpay.ts), not Supabase Edge Functions.

type WhatsappStatus = {
  id?: string; // our provider_message_id
  status?: "sent" | "delivered" | "read" | "failed";
  timestamp?: string;
  errors?: Array<{ code?: number; title?: string }>;
};

type WhatsappInboundMessage = {
  from?: string; // digits only, no leading +
  type?: string;
  text?: { body?: string };
};

type WhatsappWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        statuses?: WhatsappStatus[];
        messages?: WhatsappInboundMessage[];
      };
    }>;
  }>;
};

function hmacSha256Matches(secret: string, payload: string, signatureHeader: string) {
  const given = signatureHeader.replace(/^sha256=/, "");
  const expected = Buffer.from(createHmac("sha256", secret).update(payload).digest("hex"));
  const givenBuf = Buffer.from(given);
  return expected.length === givenBuf.length && timingSafeEqual(expected, givenBuf);
}

const STOP_KEYWORDS = new Set(["stop", "unsubscribe", "stop all"]);
// Codes Meta returns for a number that can no longer receive messages
// (deactivated / not on WhatsApp) vs transient delivery failures.
const PERMANENT_FAILURE_CODES = new Set([131026, 131047, 131051]);

export const Route = createFileRoute("/api/public/webhooks/whatsapp")({
  server: {
    handlers: {
      // Meta's one-time subscription handshake.
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");
        const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
        if (!verifyToken) return new Response("Webhook not configured", { status: 503 });
        if (mode === "subscribe" && token === verifyToken && challenge) {
          return new Response(challenge, { status: 200 });
        }
        return new Response("Forbidden", { status: 403 });
      },

      POST: async ({ request }) => {
        const appSecret = process.env.WHATSAPP_APP_SECRET;
        if (!appSecret) return new Response("Webhook not configured", { status: 503 });

        const signature = request.headers.get("x-hub-signature-256");
        const rawBody = await request.text();
        if (!signature || !hmacSha256Matches(appSecret, rawBody, signature)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: WhatsappWebhookPayload;
        try {
          payload = JSON.parse(rawBody);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        for (const entry of payload.entry ?? []) {
          for (const change of entry.changes ?? []) {
            const value = change.value;
            if (!value) continue;

            for (const status of value.statuses ?? []) {
              await applyStatus(supabaseAdmin, status);
            }
            for (const message of value.messages ?? []) {
              await applyInbound(supabaseAdmin, message);
            }
          }
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});

async function applyStatus(
  supabaseAdmin: Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"],
  status: WhatsappStatus,
) {
  if (!status.id || !status.status) return;
  const at = status.timestamp
    ? new Date(Number(status.timestamp) * 1000).toISOString()
    : new Date().toISOString();
  const columnByStatus: Record<string, string> = {
    sent: "sent_at",
    delivered: "delivered_at",
    read: "read_at",
    failed: "failed_at",
  };
  const column = columnByStatus[status.status];
  const update: Record<string, unknown> = { status: status.status };
  if (column) update[column] = at;
  if (status.status === "failed") {
    update.status_detail = status.errors?.[0]?.title ?? "Delivery failed";
  }

  const { data: row } = await supabaseAdmin
    .from("whatsapp_messages")
    .update(update as never)
    .eq("provider_message_id", status.id)
    .select("recipient_user")
    .maybeSingle();
  if (!row) return;

  const recipientUser = (row as { recipient_user: string | null }).recipient_user;
  if (!recipientUser) return;

  // D7: a permanent failure suppresses future sends; a later successful
  // delivery to the same number (e.g. it was reassigned/reactivated) lifts
  // the suppression again rather than leaving it stuck "invalid" forever.
  if (
    status.status === "failed" &&
    status.errors?.some((e) => e.code && PERMANENT_FAILURE_CODES.has(e.code))
  ) {
    await supabaseAdmin
      .from("candidate_profiles")
      .update({ whatsapp_number_status: "invalid" } as never)
      .eq("user_id", recipientUser);
  } else if (status.status === "delivered" || status.status === "read") {
    await supabaseAdmin
      .from("candidate_profiles")
      .update({ whatsapp_number_status: "valid" } as never)
      .eq("user_id", recipientUser)
      .eq("whatsapp_number_status", "invalid");
  }
}

async function applyInbound(
  supabaseAdmin: Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"],
  message: WhatsappInboundMessage,
) {
  const body = message.text?.body?.trim().toLowerCase();
  if (!body || !STOP_KEYWORDS.has(body) || !message.from) return;

  const fromE164 = `+${message.from}`;
  const { data: candidate } = await supabaseAdmin
    .from("candidate_profiles")
    .select("user_id, notification_prefs")
    .eq("whatsapp_number", fromE164)
    .maybeSingle();
  if (!candidate) return;
  const { user_id: userId, notification_prefs: prefs } = candidate as {
    user_id: string;
    notification_prefs: Record<string, unknown> | null;
  };

  await supabaseAdmin.rpc(
    "record_whatsapp_consent_for" as never,
    {
      _user: userId,
      _opted_in: false,
      _source: "stop_keyword",
    } as never,
  );
  await supabaseAdmin
    .from("candidate_profiles")
    .update({ notification_prefs: { ...(prefs ?? {}), whatsapp_alerts: false } } as never)
    .eq("user_id", userId);
  await supabaseAdmin
    .from("candidate_job_alerts")
    .update({ whatsapp_enabled: false } as never)
    .eq("user_id", userId);

  const { sendWhatsappText } = await import("@/lib/whatsapp.server");
  await sendWhatsappText({
    to: fromE164,
    body: "You've been unsubscribed from JobsKart WhatsApp alerts. Reply START anytime to turn them back on, or manage this in Settings on the app.",
  }).catch(() => undefined);
}
