import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export type DocPreview = { url: string; name: string; isImage: boolean };

/**
 * Signs a candidate-docs file and loads it into a blob for the in-page viewer. Returns null (after
 * opening the signed URL in a new tab, the previous behaviour) when the file can't be fetched into
 * the page, e.g. a CORS block, so a document is never unopenable.
 */
export async function loadDocPreview(path: string, name: string): Promise<DocPreview | null> {
  const { data } = await supabase.storage.from("candidate-docs").createSignedUrl(path, 3600);
  if (!data?.signedUrl) {
    toast.error("Couldn't open document. Please try again.");
    return null;
  }
  try {
    const res = await fetch(data.signedUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const isImage = blob.type.startsWith("image/") || /\.(png|jpe?g)$/i.test(name);
    return { url: URL.createObjectURL(blob), name, isImage };
  } catch {
    window.open(data.signedUrl, "_blank", "noopener");
    return null;
  }
}

/** In-page document overlay. Same backdrop pattern as ApplyDialog: only a click landing directly
 *  on the backdrop closes it, never one bubbling up from inside the modal. */
export function DocumentPreviewModal({
  preview,
  onClose,
}: {
  preview: DocPreview;
  onClose: () => void;
}) {
  // Release the blob when the preview is closed or replaced.
  useEffect(() => () => URL.revokeObjectURL(preview.url), [preview.url]);

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-card shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <p className="min-w-0 truncate text-sm font-semibold text-foreground">{preview.name}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="rounded p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-surface">
          {preview.isImage ? (
            <img
              src={preview.url}
              alt={preview.name}
              className="mx-auto max-h-full max-w-full object-contain"
            />
          ) : (
            <iframe src={preview.url} title={preview.name} className="h-full w-full border-0" />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
