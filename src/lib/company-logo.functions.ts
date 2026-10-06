import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MAX_LOGO_SIZE_BYTES } from "./company-logo";
import { assertCompanyMember } from "./boost.functions";

// Base64 inflates by 4/3; reject oversized payloads before decoding anything.
const MAX_BASE64_LENGTH = Math.ceil(MAX_LOGO_SIZE_BYTES / 3) * 4 + 4;

const inputSchema = z.object({
  companyId: z.string().uuid(),
  fileName: z.string().max(255),
  mimeType: z.string().max(100),
  dataBase64: z.string().max(MAX_BASE64_LENGTH + 1),
});

/**
 * The only path for writing company logos. Browser-side writes to the
 * company-logos bucket are revoked (see the logo-upload migration), so bad
 * files can't be stored even if the frontend checks are bypassed.
 */
export const uploadCompanyLogo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { setResponseStatus } = await import("@tanstack/react-start/server");
    const { validateLogoUpload, LogoValidationError } = await import("./company-logo.server");
    const { LOGO_SIZE_ERROR } = await import("./company-logo");
    try {
      await assertCompanyMember(context.supabase, context.userId, data.companyId);

      if (data.dataBase64.length > MAX_BASE64_LENGTH) throw new LogoValidationError(LOGO_SIZE_ERROR, 413);
      const bytes = new Uint8Array(Buffer.from(data.dataBase64, "base64"));
      const { ext, mime } = await validateLogoUpload({
        bytes,
        fileName: data.fileName,
        mimeType: data.mimeType,
      });

      // Server-chosen name: the client filename is never used in the path.
      const path = `${data.companyId}/logo-${crypto.randomUUID()}.${ext}`;
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const up = await supabaseAdmin.storage
        .from("company-logos")
        .upload(path, bytes, { contentType: mime, upsert: false, cacheControl: "3600" });
      if (up.error) throw new Error(up.error.message);

      const { data: signed, error: signErr } = await supabaseAdmin.storage
        .from("company-logos")
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      if (signErr || !signed?.signedUrl) throw new Error("Could not create logo link.");

      const { error: updErr } = await supabaseAdmin
        .from("companies")
        .update({ logo_url: signed.signedUrl })
        .eq("id", data.companyId);
      if (updErr) throw new Error(updErr.message);

      return { logoUrl: signed.signedUrl };
    } catch (e) {
      if (e instanceof LogoValidationError) setResponseStatus(e.status);
      throw e;
    }
  });
