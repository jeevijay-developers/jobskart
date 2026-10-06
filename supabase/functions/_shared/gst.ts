// GSTIN lookup adapter. Provider-specific details live only in this file, so
// switching providers later touches nothing else (same pattern as
// _shared/resend.ts and _shared/whatsapp.ts).
//
// Provider: gstinapi.com — GET {base}/api/get-taxpayer-info/{gstin}, auth via
// the `x-api-key` header. Each successful lookup costs one credit; failed
// lookups are not charged.
//
// Secrets (set with `supabase secrets set`):
//   GSTIN_API_KEY   required to enable instant verification
//   GSTIN_API_BASE  optional, defaults to https://gstinapi.com

const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]$/;

export type GstinLookup =
  | { ok: true; gstin: string; legalName: string | null; tradeName: string | null; status: string | null }
  | { ok: false; reason: "invalid_format" | "not_configured" | "not_found" | "upstream_error"; detail?: string };

export function isValidGstin(gstin: string): boolean {
  return GSTIN_PATTERN.test(gstin);
}

export async function lookupGstin(gstin: string): Promise<GstinLookup> {
  if (!isValidGstin(gstin)) return { ok: false, reason: "invalid_format" };

  const apiKey = Deno.env.get("GSTIN_API_KEY");
  if (!apiKey) return { ok: false, reason: "not_configured" };
  const base = (Deno.env.get("GSTIN_API_BASE") || "https://gstinapi.com").replace(/\/+$/, "");

  try {
    const res = await fetch(`${base}/api/get-taxpayer-info/${gstin}`, {
      method: "GET",
      headers: { "x-api-key": apiKey, Accept: "application/json" },
    });
    if (res.status === 404) return { ok: false, reason: "not_found" };
    if (!res.ok) {
      const body = await res.text();
      console.error("[gst] lookup failed", res.status, body);
      return { ok: false, reason: "upstream_error", detail: `HTTP ${res.status}` };
    }
    const json = (await res.json()) as {
      taxpayer_data?: { gstin?: string; name?: string; tradename?: string; status?: string };
    };
    const t = json.taxpayer_data;
    if (!t?.gstin) return { ok: false, reason: "not_found" };
    return {
      ok: true,
      gstin: t.gstin,
      legalName: t.name ?? null,
      tradeName: t.tradename ?? null,
      status: t.status ?? null,
    };
  } catch (e) {
    console.error("[gst] lookup threw", e);
    return { ok: false, reason: "upstream_error", detail: e instanceof Error ? e.message : String(e) };
  }
}
