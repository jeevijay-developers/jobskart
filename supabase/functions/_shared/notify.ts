import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { sendTemplate, type WhatsappTemplateVariable } from "./whatsapp.ts";

/**
 * D4/D9 fanout for the WhatsApp side of a utility event. In-app rows are
 * still written by DB triggers (unchanged) and email is still sent
 * independently by each edge function's existing Resend call (unchanged) —
 * this only adds the WhatsApp leg, called alongside those, not replacing
 * them. Centralizing it here means caps/consent/logging/dedup are written
 * once instead of five times across application-status-notify,
 * interview-scheduled, interview-reminder, alert-instant-notify and
 * alert-digest.
 *
 * Never throws — a WhatsApp failure must not block the email/in-app paths
 * that already work today.
 */
export async function sendWhatsappForEvent(
  admin: SupabaseClient,
  opts: {
    userId: string;
    templateKey: string;
    variables: WhatsappTemplateVariable[];
    source: string;
    reference: Record<string, string | null | undefined>;
    /**
     * Uniquely identifies this exact event occurrence (e.g.
     * `app:${applicationId}:${status}`, `ivsched:${interviewId}:${scheduledAtIso}`).
     * Claimed via an INSERT before the provider is ever called — a second
     * concurrent/retried call for the same key hits the unique constraint on
     * whatsapp_messages.dedupe_key and returns without sending anything.
     * Omit only for events that already carry their own upstream dedup
     * guard (alert-instant-notify/alert-digest insert into
     * alert_job_notifications before calling this function at all).
     */
    dedupeKey?: string;
  },
): Promise<{ sent: boolean; reason?: string }> {
  try {
    const { data: eligible } = await admin.rpc("should_send_whatsapp", { _user_id: opts.userId });
    if (!eligible) return { sent: false, reason: "not_eligible" };

    const { data: template } = await admin
      .from("whatsapp_templates")
      .select("provider_template_id, language, status")
      .eq("key", opts.templateKey)
      .maybeSingle();
    if (!template || template.status === "paused") {
      return { sent: false, reason: "no_template" };
    }

    const { data: profile } = await admin
      .from("candidate_profiles")
      .select("whatsapp_number")
      .eq("user_id", opts.userId)
      .maybeSingle();
    const to = profile?.whatsapp_number as string | undefined;
    if (!to) return { sent: false, reason: "no_number" };

    // Claim the dedupe slot BEFORE calling the provider — logging after
    // sending (the previous design) only caught duplicate log rows, not
    // duplicate sends, since by the time the insert ran the message had
    // already gone out twice.
    const { data: claimed, error: claimError } = await admin
      .from("whatsapp_messages")
      .insert({
        recipient_user: opts.userId,
        recipient_number: to,
        template_key: opts.templateKey,
        category: "utility",
        variables: opts.variables,
        source: opts.source,
        reference: opts.reference,
        dedupe_key: opts.dedupeKey ?? null,
        status: "queued",
        attempts: 1,
      })
      .select("id")
      .single();
    if (claimError) {
      if (claimError.message.includes("duplicate key")) {
        return { sent: false, reason: "duplicate" };
      }
      console.error("[notify] whatsapp_messages claim insert failed", claimError.message);
      return { sent: false, reason: claimError.message };
    }
    const messageId = claimed.id as string;

    const { error: capError } = await admin.rpc("register_whatsapp_send_for", {
      _user: opts.userId,
      _count: 1,
    });
    if (capError) {
      console.warn("[notify] WhatsApp cap reached", opts.userId, capError.message);
      await admin
        .from("whatsapp_messages")
        .update({
          status: "failed",
          status_detail: "cap_reached",
          failed_at: new Date().toISOString(),
        })
        .eq("id", messageId);
      return { sent: false, reason: "cap_reached" };
    }

    const result = await sendTemplate({
      to,
      templateName: template.provider_template_id,
      languageCode: template.language,
      variables: opts.variables,
    });

    await admin
      .from("whatsapp_messages")
      .update({
        status: result.ok ? "sent" : "failed",
        status_detail: result.ok ? null : result.error,
        sent_at: result.ok ? new Date().toISOString() : null,
        failed_at: result.ok ? null : new Date().toISOString(),
        provider_message_id: result.ok ? result.providerMessageId : null,
      })
      .eq("id", messageId);

    if (!result.ok && !result.retryable) {
      // D7: a permanent provider error suppresses future sends until a later
      // delivery succeeds (the status webhook can also set this back to 'valid').
      await admin
        .from("candidate_profiles")
        .update({ whatsapp_number_status: "invalid" })
        .eq("user_id", opts.userId);
    }

    return result.ok ? { sent: true } : { sent: false, reason: result.error };
  } catch (e) {
    console.error("[notify] sendWhatsappForEvent threw", e);
    return { sent: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
