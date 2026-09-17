// Shared CORS handling for Edge Functions invoked directly from the browser
// via supabase.functions.invoke(...) (as opposed to Database Webhooks / pg_cron,
// which are server-to-server and never subject to browser CORS).
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Call first in every browser-invoked function; returns the preflight response
// if this is an OPTIONS request, or null if the caller should keep handling it.
export function handleCorsPreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  return null;
}
