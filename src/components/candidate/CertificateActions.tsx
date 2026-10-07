import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getCertificateFileUrl } from "@/lib/certificates.functions";
import { DocumentPreviewModal, type DocPreview } from "@/components/candidate/DocumentPreviewModal";

const btn =
  "inline-flex min-h-11 items-center gap-2 rounded-lg px-5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60";

/**
 * View (in-app preview, no new tab) + Download for the signed-in candidate's own certificate.
 * The PDF is fetched through a short-lived signed URL; storage RLS limits it to their own files.
 */
export function CertificateActions({ certificateId }: { certificateId: string }) {
  const getUrl = useServerFn(getCertificateFileUrl);
  const [busy, setBusy] = useState<"view" | "download" | null>(null);
  const [preview, setPreview] = useState<DocPreview | null>(null);

  const loadBlob = async () => {
    const { url } = await getUrl({ data: { certificateId } });
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  };

  const view = async () => {
    setBusy("view");
    try {
      const blob = await loadBlob();
      setPreview({ url: URL.createObjectURL(blob), name: `${certificateId}.pdf`, isImage: false });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't open the certificate.");
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    setBusy("download");
    try {
      const blob = await loadBlob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `${certificateId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't download the certificate.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void view()}
          disabled={busy !== null}
          className={`${btn} bg-primary text-primary-foreground`}
        >
          {busy === "view" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
          View Certificate
        </button>
        <button
          type="button"
          onClick={() => void download()}
          disabled={busy !== null}
          className={`${btn} border border-border bg-card text-foreground`}
        >
          {busy === "download" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Download Certificate
        </button>
      </div>
      {preview && <DocumentPreviewModal preview={preview} onClose={() => setPreview(null)} />}
    </>
  );
}
