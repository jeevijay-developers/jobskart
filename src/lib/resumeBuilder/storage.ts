// src/lib/resumeBuilder/storage.ts
import { supabaseAdmin } from '../../integrations/supabase/client.server';

export const RESUME_EXPORTS_BUCKET = 'resume-exports';

export function resumePdfPath(userId: string, versionNumber: number): string {
  return `${userId}/v${versionNumber}.pdf`;
}

/**
 * Upload a PDF buffer to the private Supabase storage bucket `resume-exports`.
 * Returns the public URL (if bucket is public) or a signed URL.
 * Bucket must be configured as private; we will generate a signed URL valid for 1 hour.
 */
export async function uploadResumePdf(
  userId: string,
  versionNumber: number,
  pdfBuffer: Buffer
): Promise<string> {
  const fileName = resumePdfPath(userId, versionNumber);

  const { data, error } = await supabaseAdmin.storage
    .from(RESUME_EXPORTS_BUCKET)
    .upload(fileName, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true, // overwrite if exists
    });

  if (error) {
    throw error;
  }

  // Get a signed URL (valid for 1 hour)
  const { data: signed, error: signedError } = await supabaseAdmin.storage
    .from('resume-exports')
    .createSignedUrl(fileName, 3600);

  if (signedError || !signed) {
    throw signedError ?? new Error('Failed to create signed URL');
  }

  return signed.signedUrl;
}