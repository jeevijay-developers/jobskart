import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getCandidateResume, type CandidateResume } from "@/lib/candidateResume";
import { ApplicationFormFields } from "@/components/candidate/ApplicationFormFields";

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

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (async () => {
      const r = await getCandidateResume(userId);
      setResume(r);
      setLoading(false);
    })();
  }, [open, userId]);

  if (!open) return null;

  const viewResume = async () => {
    if (!resume) return;
    setViewingResume(true);
    const { data, error } = await supabase.storage
      .from("candidate-docs")
      .createSignedUrl(resume.path, 3600);
    setViewingResume(false);
    if (error || !data?.signedUrl) {
      toast.error("Couldn't open resume. Please try again.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
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
    </div>
  );
}
