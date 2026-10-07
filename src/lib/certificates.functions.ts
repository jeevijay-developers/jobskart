import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CERT_ASSET_PATH_RE } from "@/lib/certificate-layout";

// ── Admin: certificate template / branding assets (private "certificates" bucket) ──────────────
// Uploads go browser → Storage directly (see CertificateSettings.uploadAsset); only previews are signed here.

async function assertAdmin(context: {
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown }> };
  userId: string;
}) {
  const { data: isAdmin } = await context.supabase.rpc("has_platform_role", {
    _user_id: context.userId,
    _role: "super_admin",
  });
  if (!isAdmin) throw new Error("Admin access required.");
}

/** Signed preview URLs for already-saved asset paths (admin form edit mode). */
export const getCertificateAssetUrls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z.object({ paths: z.array(z.string().regex(CERT_ASSET_PATH_RE)).max(8) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const out: Record<string, string> = {};
    for (const p of data.paths) {
      const { data: signed } = await supabaseAdmin.storage.from("certificates").createSignedUrl(p, 3600);
      if (signed?.signedUrl) out[p] = signed.signedUrl;
    }
    return out;
  });

// ── Candidate: earned certificates ──────────────────────────────────────────────────────────────

export type MyCertificate = {
  certificate_id: string;
  score: number;
  issued_at: string;
  valid_until: string | null;
  status: string;
};

/** The signed-in candidate's certificate for a certification (RLS: only their own row). */
export const getMyCertificate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ certificationId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }): Promise<MyCertificate | null> => {
    const { data: row, error } = await context.supabase
      .from("certificates" as never)
      .select("certificate_id, score, issued_at, valid_until, status")
      .eq("candidate_id", context.userId)
      .eq("certification_id", data.certificationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (row as unknown as MyCertificate | null) ?? null;
  });

/** Short-lived signed URL for the candidate's own certificate PDF (storage RLS also enforces ownership). */
export const getCertificateFileUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ certificateId: z.string().min(3).max(60) }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("certificates" as never)
      .select("certificate_file_url")
      .eq("candidate_id", context.userId)
      .eq("certificate_id", data.certificateId)
      .maybeSingle();
    const path = (row as unknown as { certificate_file_url: string | null } | null)?.certificate_file_url;
    if (!path) throw new Error("Certificate not found.");
    const { data: signed, error } = await context.supabase.storage
      .from("certificates")
      .createSignedUrl(path, 3600);
    if (error || !signed?.signedUrl) throw new Error("Couldn't open the certificate. Please try again.");
    return { url: signed.signedUrl };
  });
