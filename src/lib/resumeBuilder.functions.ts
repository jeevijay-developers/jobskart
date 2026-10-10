import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { RESUME_EXPORTS_BUCKET, resumePdfPath, uploadResumePdf } from "@/lib/resumeBuilder/storage";
import { RESUME_VERSION_NAME_MAX } from "@/lib/resumeBuilder/limits";
import type { ResumeSchema } from "@/lib/resumeBuilder/schema";

// PDFs written before this moment predate the JobsKart watermark.
const WATERMARK_SINCE = Date.parse("2026-10-09T00:00:00Z");

// Renames one saved resume version. An empty name clears it back to the default "Version N".
// Ownership is enforced by filtering on context.userId, never on a client-supplied id.
export const renameResumeVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { versionNumber: number; name: string }) =>
    z
      .object({
        versionNumber: z.number().int().positive(),
        name: z.string().trim().max(RESUME_VERSION_NAME_MAX),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: updated, error } = await supabaseAdmin
      .from("resume_versions")
      .update({ name: data.name === "" ? null : data.name } as never)
      .eq("user_id", context.userId)
      .eq("version_number", data.versionNumber)
      .select("version_number");
    if (error) {
      // Logged server-side (e.g. the `name` column missing because a migration wasn't applied).
      console.error("[resume-builder] rename failed:", error.message);
      throw new Error("Couldn't rename this resume version");
    }
    if (!updated || updated.length === 0) throw new Error("Resume version not found");
    return { success: true, name: data.name === "" ? null : data.name };
  });

// Deletes one saved resume version — both the resume_versions row and its
// generated PDF in storage, so a deleted version doesn't leave an orphaned
// file behind. Ownership is re-checked against context.userId (never trusted
// from the client-supplied versionNumber alone), same pattern as
// getResumeVersionPdfUrl above. Storage deletion failing isn't fatal (the PDF
// may never have been generated for this version, or already be gone) — the
// row delete is what actually removes it from the candidate's version list.
export const deleteResumeVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { versionNumber: number }) =>
    z.object({ versionNumber: z.number().int().positive() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error: findErr } = await supabaseAdmin
      .from("resume_versions")
      .select("version_number")
      .eq("user_id", context.userId)
      .eq("version_number", data.versionNumber)
      .maybeSingle();
    if (findErr || !row) throw new Error("Resume version not found");

    const path = resumePdfPath(context.userId, data.versionNumber);
    await supabaseAdmin.storage.from(RESUME_EXPORTS_BUCKET).remove([path]);

    const { error: deleteErr } = await supabaseAdmin
      .from("resume_versions")
      .delete()
      .eq("user_id", context.userId)
      .eq("version_number", data.versionNumber);
    if (deleteErr) throw new Error("Couldn't delete this resume version");

    return { success: true };
  });

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
      .select("version_number, snapshot")
      .eq("user_id", context.userId)
      .eq("version_number", data.versionNumber)
      .maybeSingle();
    if (error || !row) throw new Error("Resume version not found");

    const path = resumePdfPath(context.userId, data.versionNumber);

    // PDFs stored before the JobsKart watermark existed are re-rendered once from the version's own
    // saved snapshot (same template/layout/content), so every download carries the watermark.
    // Best effort: on any failure the existing stored PDF is served unchanged.
    try {
      const { data: files } = await supabaseAdmin.storage
        .from(RESUME_EXPORTS_BUCKET)
        .list(context.userId, { search: `v${data.versionNumber}.pdf` });
      const stored = files?.find((f) => f.name === `v${data.versionNumber}.pdf`);
      const writtenAt = stored?.updated_at ? Date.parse(stored.updated_at) : NaN;
      if (stored && writtenAt < WATERMARK_SINCE) {
        const { renderResumeToPdf } = await import("@/lib/resumeBuilder/renderResumePdf.server");
        const buffer = await renderResumeToPdf(row.snapshot as unknown as ResumeSchema);
        await uploadResumePdf(context.userId, data.versionNumber, buffer);
      }
    } catch (e) {
      console.error("[resume-builder] watermark refresh skipped:", e instanceof Error ? e.message : e);
    }

    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(RESUME_EXPORTS_BUCKET)
      .createSignedUrl(path, 3600);
    if (signErr || !signed) {
      throw new Error("Couldn't generate a download link for this version — try regenerating it.");
    }
    return { url: signed.signedUrl };
  });
