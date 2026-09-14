import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Service-role client for Edge Functions — SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY are provided automatically by the Supabase Edge
 * Functions runtime (no `supabase secrets set` needed for these two).
 */
export function createAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not available");
  return createClient(url, key);
}
