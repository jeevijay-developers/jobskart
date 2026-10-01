import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { RESUME_EXPORTS_BUCKET, resumePdfPath } from "@/lib/resumeBuilder/storage";

// Lets the candidate re-download or re-preview-link any past resume version,
// not just the most recently generated one. The PDF for each version is
// already stored at a deterministic per-version path (resumePdfPath) by
// uploadResumePdf() — this just mints a fresh signed URL for it, scoped to
// the caller's own versions via context.userId (ownership also re-checked
// against resume_versions, not trusted from the client-supplied versionNumber alone).
export const getResumeVersionPdfUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { versionNumber: number }) =>
    z.object({ versionNumber: z.number().int().positive() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await supabaseAdmin
      .from("resume_versions")
      .select("version_number")
      .eq("user_id", context.userId)
      .eq("version_number", data.versionNumber)
      .maybeSingle();
    if (error || !row) throw new Error("Resume version not found");

    const path = resumePdfPath(context.userId, data.versionNumber);
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(RESUME_EXPORTS_BUCKET)
      .createSignedUrl(path, 3600);
    if (signErr || !signed) {
      throw new Error("Couldn't generate a download link for this version — try regenerating it.");
    }
    return { url: signed.signedUrl };
  });
