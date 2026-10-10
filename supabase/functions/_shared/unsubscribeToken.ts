async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * One-click unsubscribe token for alert emails (RFC 8058 List-Unsubscribe).
 * Deterministic HMAC-SHA256(user_id) — no DB round trip or expiry needed,
 * since the only thing it can ever do is turn email alerts off, a
 * reversible, low-stakes action. Verified server-side in
 * src/routes/api/public/alerts-unsubscribe.ts using the same
 * ALERT_UNSUBSCRIBE_SECRET value (set once via `supabase secrets set` for
 * this Edge Function runtime AND in the app's own env — Deno.env and
 * process.env don't share a secret store across the two runtimes).
 * Returns null (caller omits the header/link) when the secret isn't configured.
 */
export async function signUnsubscribeToken(userId: string): Promise<string | null> {
  const secret = Deno.env.get("ALERT_UNSUBSCRIBE_SECRET");
  if (!secret) return null;
  return hmacHex(secret, userId);
}
