import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FileText, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { RESUME_ACCEPT, validateResumeFile } from "@/lib/validators";

type Props = {
  open: boolean;
  onClose: () => void;
  userId: string;
  job: {
    id: string;
    company_id: string;
    title: string;
    min_salary: number | null;
    max_salary: number | null;
  };
  onApplied: () => void;
};

type ExistingResume = { path: string; name: string } | null;

export function ApplyDialog({ open, onClose, userId, job, onApplied }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [existing, setExisting] = useState<ExistingResume>(null);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [expectedSalary, setExpectedSalary] = useState<string>("");
  const [availableFrom, setAvailableFrom] = useState<string>("");
  const [coverNote, setCoverNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setNewFile(null);
    setCoverNote("");
    setLoading(true);
    (async () => {
      const [{ data: cp }, { data: docs }] = await Promise.all([
        supabase.from("candidate_profiles").select("resume_url, expected_salary").eq("user_id", userId).maybeSingle(),
        supabase
          .from("candidate_documents")
          .select("file_path, file_name")
          .eq("user_id", userId)
          .eq("doc_type", "resume")
          .order("created_at", { ascending: false })
          .limit(1),
      ]);
      const path = cp?.resume_url || docs?.[0]?.file_path || null;
      const name = docs?.[0]?.file_name || (path ? path.split("/").pop() || "Resume" : "");
      setExisting(path ? { path, name } : null);
      setExpectedSalary(cp?.expected_salary ? String(cp.expected_salary) : "");
      setAvailableFrom(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
      setLoading(false);
    })();
  }, [open, userId]);

  if (!open) return null;

  const pickFile = () => fileRef.current?.click();

  const onFile = (f: File) => {
    const err = validateResumeFile(f);
    if (err) {
      toast.error(err);
      return;
    }
    setNewFile(f);
    setErrors((e) => ({ ...e, resume: "" }));
  };

  const validate = () => {
    const next: Record<string, string> = {};
    if (!existing && !newFile) next.resume = "Please upload your resume to apply.";
    const sal = Number(expectedSalary);
    if (!expectedSalary || !Number.isFinite(sal) || sal <= 0) next.salary = "Enter a valid expected monthly salary.";
    else if (sal > 100_000_000) next.salary = "Salary looks too high.";
    if (availableFrom) {
      const d = new Date(availableFrom);
      if (Number.isNaN(d.getTime())) next.available = "Pick a valid date.";
    }
    if (coverNote.length > 1000) next.cover = "Cover note must be under 1000 characters.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    if (!validate()) {
      toast.error("Please fix the highlighted fields before submitting.");
      return;
    }
    setSubmitting(true);
    try {
      // Make sure we're authenticated client-side before hitting RLS-guarded tables
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session?.user?.id || sess.session.user.id !== userId) {
        throw new Error("Your session expired. Please sign in again to apply.");
      }

      // upload new resume if provided
      if (newFile) {
        setUploading(true);
        const ext = (newFile.name.split(".").pop() || "bin").toLowerCase();
        const path = `${userId}/resume-${Date.now()}-${crypto.randomUUID()}.${ext}`;
        const up = await supabase.storage
          .from("candidate-docs")
          .upload(path, newFile, { upsert: true, contentType: newFile.type || undefined });
        setUploading(false);
        if (up.error) {
          console.error("[ApplyDialog] resume upload failed", up.error);
          throw new Error(`Couldn't upload resume: ${up.error.message}`);
        }
        const [docRes, profRes] = await Promise.all([
          supabase.from("candidate_documents").insert({
            user_id: userId,
            doc_type: "resume",
            file_path: path,
            file_name: newFile.name,
            size_bytes: newFile.size,
          }),
          supabase.from("candidate_profiles").update({ resume_url: path }).eq("user_id", userId),
        ]);
        if (docRes.error) console.warn("[ApplyDialog] document record insert failed", docRes.error);
        if (profRes.error) console.warn("[ApplyDialog] profile resume_url update failed", profRes.error);
      }

      const { error } = await supabase.from("applications").insert({
        job_id: job.id,
        company_id: job.company_id,
        candidate_id: userId,
        expected_salary: Number(expectedSalary),
        available_from: availableFrom || null,
        cover_note: coverNote.trim() || null,
      });

      if (error) {
        console.error("[ApplyDialog] application insert failed", error);
        // 23505 = unique_violation (already applied)
        if ((error as { code?: string }).code === "23505") {
          toast.success("You've already applied to this job.");
          onApplied();
          onClose();
          return;
        }
        if ((error as { code?: string }).code === "42501") {
          throw new Error("You don't have permission to apply. Please sign in again.");
        }
        throw new Error(error.message || "Could not submit your application.");
      }

      toast.success("Application submitted! The employer will review your profile.");
      onApplied();
      onClose();
    } catch (e) {
      console.error("[ApplyDialog] submit failed", e);
      const msg = e instanceof Error && e.message ? e.message : "Could not submit application. Please try again.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
      setUploading(false);
    }
  };


  const resumeLabel = newFile?.name || existing?.name || "";

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-card shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Apply to job</p>
            <h2 className="mt-1 truncate text-lg font-bold text-foreground">{job.title}</h2>
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
            <>
              {/* Resume */}
              <div>
                <label className="text-sm font-semibold text-foreground">Resume <span className="text-destructive">*</span></label>
                <p className="mt-0.5 text-xs text-muted-foreground">PDF, DOC, DOCX, PNG or JPG · max 5 MB</p>

                {(existing || newFile) && (
                  <div className="mt-2 flex items-center gap-3 rounded-lg border border-border bg-surface/60 p-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{resumeLabel}</p>
                      <p className="text-xs text-muted-foreground">
                        {newFile ? "New upload — will replace your current resume" : "On file"}
                      </p>
                    </div>
                    {newFile && (
                      <button
                        onClick={() => setNewFile(null)}
                        className="text-xs font-semibold text-muted-foreground hover:text-destructive"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={pickFile}
                  className="mt-2 inline-flex h-10 items-center gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-4 text-sm font-semibold text-primary hover:bg-primary/10"
                >
                  <Upload className="h-4 w-4" />
                  {existing || newFile ? "Upload a different resume" : "Upload resume"}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept={RESUME_ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onFile(f);
                    e.currentTarget.value = "";
                  }}
                />
                {errors.resume && <p className="mt-1.5 text-xs font-medium text-destructive">{errors.resume}</p>}
              </div>

              {/* Salary + available from */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-semibold text-foreground">Expected salary (₹/month) <span className="text-destructive">*</span></label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={expectedSalary}
                    onChange={(e) => setExpectedSalary(e.target.value)}
                    placeholder="e.g. 35000"
                    className="mt-1 h-10 w-full rounded-lg border border-input bg-card px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  {job.min_salary || job.max_salary ? (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Job range: ₹{(job.min_salary ?? 0).toLocaleString("en-IN")} – ₹{(job.max_salary ?? 0).toLocaleString("en-IN")} /month
                    </p>
                  ) : null}
                  {errors.salary && <p className="mt-1 text-xs font-medium text-destructive">{errors.salary}</p>}
                </div>
                <div>
                  <label className="text-sm font-semibold text-foreground">Available from</label>
                  <input
                    type="date"
                    value={availableFrom}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setAvailableFrom(e.target.value)}
                    className="mt-1 h-10 w-full rounded-lg border border-input bg-card px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  {errors.available && <p className="mt-1 text-xs font-medium text-destructive">{errors.available}</p>}
                </div>
              </div>

              {/* Cover note */}
              <div>
                <label className="text-sm font-semibold text-foreground">Cover note <span className="text-xs font-normal text-muted-foreground">(optional)</span></label>
                <textarea
                  rows={4}
                  value={coverNote}
                  onChange={(e) => setCoverNote(e.target.value.slice(0, 1000))}
                  placeholder="Tell the employer why you're a great fit…"
                  className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span className={errors.cover ? "text-destructive font-medium" : ""}>{errors.cover || " "}</span>
                  <span>{coverNote.length}/1000</span>
                </div>
              </div>

              <div className="rounded-lg border border-success/20 bg-success-light/40 p-3 text-xs text-foreground/80">
                <p className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                  Your profile, resume and contact details will be shared with the employer.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border bg-surface/60 p-4">
          <button
            onClick={onClose}
            disabled={submitting}
            className="h-10 rounded-lg px-4 text-sm font-semibold text-foreground hover:bg-card disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || loading}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {uploading ? "Uploading…" : "Submitting…"}
              </>
            ) : (
              "Submit application"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
