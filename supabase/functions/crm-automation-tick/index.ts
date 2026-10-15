import { createAdminClient } from "../_shared/supabaseAdmin.ts";

// Invoked every 10 minutes by the 'crm-automation-tick' pg_cron schedule
// (supabase/migrations/20260929090000_employer_crm_automation.sql) via
// net.http_post with the service-role key — same wiring as job-expiry-sweep.
// All the rule-matching, dedupe/cooldown/fire-cap checks, and action
// execution (create_task / notify / move_stage) happen inside
// crm_tick_automation() itself; this function only invokes it.
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("crm_tick_automation", { _batch: 200 });
  if (error) {
    console.error("[crm-automation-tick] failed", error);
    return new Response("ok", { status: 200 });
  }

  return Response.json(data ?? { rules_evaluated: 0, fired: 0, skipped: 0, errors: 0 });
});
