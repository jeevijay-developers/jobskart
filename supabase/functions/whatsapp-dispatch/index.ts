import { createAdminClient } from "../_shared/supabaseAdmin.ts";
import { sendTemplate } from "../_shared/whatsapp.ts";

// D7 dispatch sweeper: invoked every 10 minutes by the 'whatsapp-dispatch-sweeper'
// pg_cron job (see the Phase 4 migration) via net.http_post, same wiring as
// alert-digest/interview-reminder. Drains `queued` whatsapp_messages rows in
// batches sized to whatsapp_settings.dispatch_batch_size.
//
// Utility rows are sent inline by notify.ts at event time and normally never
// reach `queued` status (sendTemplate resolves synchronously there) — this
// sweeper exists mainly to drain `marketing` rows enqueued by the two nudge
// crons below, respecting quiet hours and the marketing frequency cap. Any
// utility row that *is* found queued (e.g. a past transient failure that was
// requeued for retry) is sent immediately with no quiet-hours/frequency gate,
// since those only apply to marketing (D6).

const RETRYABLE_MAX_ATTEMPTS = 3;

function getIstHour(d: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      hour12: false,
    }).format(d),
  );
}

function inQuietHours(hour: number, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return false;
  return startHour < endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour; // wraps past midnight, e.g. 21 -> 8
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const admin = createAdminClient();

  const { data: settings } = await admin
    .from("whatsapp_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (!settings || !settings.enabled) {
    return new Response(JSON.stringify({ ok: true, skipped: "disabled" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const now = new Date();
  const quiet = inQuietHours(getIstHour(now), settings.quiet_start_hour, settings.quiet_end_hour);

  const { data: queued, error } = await admin
    .from("whatsapp_messages")
    .select("*")
    .eq("status", "queued")
    .order("queued_at", { ascending: true })
    .limit(settings.dispatch_batch_size);

  if (error) {
    console.error("[whatsapp-dispatch] failed to load queue", error);
    return new Response("ok", { status: 200 });
  }

  let sent = 0;
  let skippedQuietHours = 0;
  let skippedFrequencyCap = 0;
  let skippedDailyCap = 0;
  let failed = 0;

  for (const msg of queued ?? []) {
    if (msg.category === "marketing") {
      if (quiet) {
        skippedQuietHours++;
        continue; // left queued — retried next sweep once quiet hours end
      }

      const gapMs = settings.marketing_min_gap_hours * 60 * 60_000;
      const windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString();
      const [{ count: recentCount }, { data: lastSent }] = await Promise.all([
        admin
          .from("whatsapp_messages")
          .select("id", { count: "exact", head: true })
          .eq("recipient_user", msg.recipient_user)
          .eq("category", "marketing")
          .eq("status", "sent")
          .gte("sent_at", windowStart),
        admin
          .from("whatsapp_messages")
          .select("sent_at")
          .eq("recipient_user", msg.recipient_user)
          .eq("category", "marketing")
          .eq("status", "sent")
          .order("sent_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      const tooSoon =
        lastSent?.sent_at && now.getTime() - new Date(lastSent.sent_at).getTime() < gapMs;
      if ((recentCount ?? 0) >= settings.marketing_per_7d || tooSoon) {
        skippedFrequencyCap++;
        continue; // left queued — retried next sweep once the window opens
      }
    }

    // Re-check consent at send time — it may have changed since this row was
    // enqueued (candidate opted out, or the number was marked invalid).
    const { data: eligible } = await admin.rpc("should_send_whatsapp", {
      _user_id: msg.recipient_user,
    });
    if (!eligible) {
      await admin
        .from("whatsapp_messages")
        .update({
          status: "failed",
          status_detail: "no_longer_eligible",
          failed_at: now.toISOString(),
        })
        .eq("id", msg.id);
      continue;
    }

    const { error: capError } = await admin.rpc("register_whatsapp_send_for", {
      _user: msg.recipient_user,
      _count: 1,
    });
    if (capError) {
      skippedDailyCap++;
      continue; // left queued — retried on a later sweep, next calendar day in practice
    }

    const { data: template } = await admin
      .from("whatsapp_templates")
      .select("provider_template_id, language, status")
      .eq("key", msg.template_key)
      .maybeSingle();
    if (!template || template.status === "paused") {
      await admin
        .from("whatsapp_messages")
        .update({
          status: "failed",
          status_detail: "template_unavailable",
          failed_at: now.toISOString(),
        })
        .eq("id", msg.id);
      failed++;
      continue;
    }

    const result = await sendTemplate({
      to: msg.recipient_number,
      templateName: template.provider_template_id,
      languageCode: template.language,
      variables: (msg.variables ?? []) as (string | number)[],
    });

    if (result.ok) {
      await admin
        .from("whatsapp_messages")
        .update({
          status: "sent",
          sent_at: now.toISOString(),
          provider_message_id: result.providerMessageId,
        })
        .eq("id", msg.id);
      sent++;
    } else if (result.retryable && msg.attempts + 1 < RETRYABLE_MAX_ATTEMPTS) {
      // Left `queued` with attempts incremented — the 10-minute sweep cadence
      // itself is the backoff, no separate timer needed.
      await admin
        .from("whatsapp_messages")
        .update({ attempts: msg.attempts + 1, status_detail: result.error })
        .eq("id", msg.id);
      failed++;
    } else {
      await admin
        .from("whatsapp_messages")
        .update({
          status: "failed",
          status_detail: result.error,
          failed_at: now.toISOString(),
          attempts: msg.attempts + 1,
        })
        .eq("id", msg.id);
      if (!result.retryable) {
        // D7: a permanent provider error (bad/deactivated number) suppresses
        // future sends to this candidate until a later delivery succeeds.
        await admin
          .from("candidate_profiles")
          .update({ whatsapp_number_status: "invalid" })
          .eq("user_id", msg.recipient_user as string);
      }
      failed++;
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      processed: (queued ?? []).length,
      sent,
      failed,
      skippedQuietHours,
      skippedFrequencyCap,
      skippedDailyCap,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
