import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getApplicationResume, getCandidateResume, type CandidateResume } from "@/lib/candidateResume";
import { ApplicationFormFields } from "@/components/candidate/ApplicationFormFields";
import { DocumentPreviewModal, type DocPreview } from "@/components/candidate/DocumentPreviewModal";

type Props = {
  open: boolean;
  onClose: () => void;
  userId: string;
  application: {
    id: string;
    status: string;
    created_at: string;
    expected_salary: number | null;
    available_from: string | null;
    cover_note: string | null;
  };
  jobTitle: string;
};

/**
 * Read-only review of what the candidate submitted when they applied. Reuses
 * ApplicationFormFields (readOnly mode) instead of duplicating the apply form's markup.
 */
export function ViewApplicationDialog({ open, onClose, userId, application, jobTitle }: Props) {
  const [loading, setLoading] = useState(true);
  const [resume, setResume] = useState<CandidateResume>(null);
  const [viewingResume, setViewingResume] = useState(false);
  const [preview, setPreview] = useState<DocPreview | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (async () => {
      // The copy submitted with this application wins; older applications fall back to the profile resume.
      const r =
        (await getApplicationResume(userId, application.id)) ?? (await getCandidateResume(userId));
      setResume(r);
      setLoading(false);
    })();
  }, [open, userId, application.id]);

  if (!open) return null;

  const viewResume = async () => {
    if (!resume) return;
    setViewingResume(true);
    const sign = (path: string) =>
      supabase.storage.from("candidate-docs").createSignedUrl(path, 3600);
    let { data, error } = await sign(resume.path);
    if (error || !data?.signedUrl) {
      console.error("[ViewApplicationDialog] couldn't sign resume", resume.path, error);
      // The profile's resume_url can outlive its file (deleting a document on /candidate/documents
      // removes the storage object and its document row, not the profile pointer). Fall back to the
      // newest resume document that still exists.
      const { data: docs } = await supabase
        .from("candidate_documents")
        .select("file_path")
        .eq("user_id", userId)
        .eq("doc_type", "resume")
        .order("created_at", { ascending: false })
        .limit(1);
      const alt = docs?.[0]?.file_path;
      if (alt && alt !== resume.path) ({ data, error } = await sign(alt));
    }
    if (error || !data?.signedUrl) {
      setViewingResume(false);
      toast.error("Couldn't open resume. Please try again.");
      return;
    }
    // Show it in the in-page preview (same viewer as the Documents page) instead of a new tab.
    try {
      const res = await fetch(data.signedUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const isImage = blob.type.startsWith("image/") || /\.(png|jpe?g)$/i.test(resume.name);
      setPreview({ url: URL.createObjectURL(blob), name: resume.name, isImage });
    } catch (e) {
      console.error("[ViewApplicationDialog] couldn't load resume for preview", e);
      toast.error("Couldn't open resume. Please try again.");
    } finally {
      setViewingResume(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        // Same pattern as ApplyDialog: only a click landing directly on the
        // backdrop closes it, never one bubbling up from inside the modal.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-card shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              Your application
            </p>
            <h2 className="mt-1 truncate text-lg font-bold text-foreground">{jobTitle}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Submitted{" "}
              {new Date(application.created_at).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </p>
          </div>
          <button
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-surface"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {loading ? (
            <div className="grid place-items-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <ApplicationFormFields
              readOnly
              resumeLabel={resume?.name || ""}
              onViewResume={resume ? viewResume : undefined}
              viewingResume={viewingResume}
              expectedSalary={
                application.expected_salary ? String(application.expected_salary) : ""
              }
              availableFrom={application.available_from || ""}
              coverNote={application.cover_note || ""}
            />
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border bg-surface/60 p-4">
          <button
            onClick={onClose}
            className="h-10 rounded-lg px-5 text-sm font-semibold text-foreground hover:bg-card"
          >
            Close
          </button>
        </div>
      </div>
      {preview && <DocumentPreviewModal preview={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
