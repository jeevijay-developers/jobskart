import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  FileText,
  GraduationCap,
  Loader2,
  MapPin,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { RESUME_ACCEPT, validateResumeFile } from "@/lib/validators";
import { applicationResumeDir, getCandidateResume } from "@/lib/candidateResume";
import { getResumeVersionPdfUrl } from "@/lib/resumeBuilder.functions";
import {
  DocumentPreviewModal,
  loadDocPreview,
  type DocPreview,
} from "@/components/candidate/DocumentPreviewModal";
import { ApplicationFormFields } from "@/components/candidate/ApplicationFormFields";
import { Badge } from "@/components/ui/badge";
import { formatExperience, formatSalary, jobTypeLabel, workModeLabel } from "@/lib/format";
import { randomId } from "@/lib/utils";

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
    // Optional — only used to render the job-summary panel. Callers that
    // already fetch this data (JobCard, the job detail page) pass it
    // through; when absent, the corresponding summary rows are just skipped.
    salary_period?: string | null;
    company_name?: string | null;
    company_verified?: boolean | null;
    job_type?: string | null;
    work_mode?: string | null;
    min_experience_years?: number | null;
    max_experience_years?: number | null;
    skills?: string[] | null;
    /** Documents/links and language levels the employer asks applicants for. */
    required_documents?: string[] | null;
    language_requirements?: { language: string; level: string }[] | null;
    created_at?: string | null;
  };
  onApplied: () => void;
};

type ExistingResume = { path: string; name: string } | null;
type ResumeMode = "saved" | "profile" | "upload";
type SavedVersion = { version_number: number; name?: string | null; created_at: string };
const safeName = (n: string) => n.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80) || "resume";

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
  const [mode, setMode] = useState<ResumeMode>("profile");
  const [versions, setVersions] = useState<SavedVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [preview, setPreview] = useState<DocPreview | null>(null);
  const [previewingKey, setPreviewingKey] = useState<string | null>(null);
  const versionPdfUrl = useServerFn(getResumeVersionPdfUrl);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setNewFile(null);
    setCoverNote("");
    setLoading(true);
    (async () => {
      // Saved Resume Builder versions (max 5); `name` is an optional newer column, retry without it.
      const loadVersions = async () => {
        const q = (cols: string) =>
          supabase
            .from("resume_versions")
            .select(cols)
            .eq("user_id", userId)
            .order("version_number", { ascending: false })
            .limit(5);
        let res = await q("version_number, name, created_at");
        if (res.error) res = await q("version_number, created_at");
        return (res.data as unknown as SavedVersion[] | null) ?? [];
      };
      const [resume, { data: cp }, savedVersions] = await Promise.all([
        getCandidateResume(userId),
        supabase
          .from("candidate_profiles")
          .select("expected_salary")
          .eq("user_id", userId)
          .maybeSingle(),
        loadVersions(),
      ]);
      setExisting(resume);
      setVersions(savedVersions);
      setSelectedVersion(savedVersions[0]?.version_number ?? null);
      setMode(resume ? "profile" : savedVersions.length ? "saved" : "upload");
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
    if (mode === "upload" && !newFile) next.resume = "Please choose a resume file to upload.";
    if (mode === "profile" && !existing) next.resume = "You don't have a profile resume yet.";
    if (mode === "saved" && selectedVersion == null) next.resume = "Select a saved resume.";
    const sal = Number(expectedSalary);
    if (!expectedSalary || !Number.isFinite(sal) || sal <= 0)
      next.salary = "Enter a valid expected monthly salary.";
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

      // Every application gets its own immutable copy of the chosen resume, stored under its
      // application id. Later edits/replacement/deletion of the profile resume or a saved version
      // never touch it, and an uploaded resume is never written to the profile or Resume Builder.
      const applicationId = crypto.randomUUID();
      const dir = applicationResumeDir(userId, applicationId);
      let attachedPath: string;
      if (mode === "upload" && newFile) {
        setUploading(true);
        const path = `${dir}/${safeName(newFile.name)}`;
        const up = await supabase.storage
          .from("candidate-docs")
          .upload(path, newFile, { upsert: false, contentType: newFile.type || undefined });
        setUploading(false);
        if (up.error) {
          console.error("[ApplyDialog] resume upload failed", up.error);
          throw new Error(`Couldn't upload resume: ${up.error.message}`);
        }
        attachedPath = path;
      } else if (mode === "profile" && existing) {
        const path = `${dir}/${safeName(existing.name)}`;
        const cp = await supabase.storage.from("candidate-docs").copy(existing.path, path);
        if (cp.error) {
          console.error("[ApplyDialog] profile resume copy failed", cp.error);
          throw new Error("Couldn't attach your profile resume. Try uploading a new one.");
        }
        attachedPath = path;
      } else if (mode === "saved" && selectedVersion != null) {
        const v = versions.find((x) => x.version_number === selectedVersion);
        const { url } = await versionPdfUrl({ data: { versionNumber: selectedVersion } });
        const res = await fetch(url);
        if (!res.ok) throw new Error("Couldn't load the saved resume. Please try again.");
        const label = v?.name?.trim() || `Version_${selectedVersion}`;
        const path = `${dir}/${safeName(label)}.pdf`;
        const up = await supabase.storage
          .from("candidate-docs")
          .upload(path, await res.blob(), { upsert: false, contentType: "application/pdf" });
        if (up.error) throw new Error("Couldn't attach the saved resume. Please try again.");
        attachedPath = path;
      } else {
        throw new Error("Please choose a resume to apply with.");
      }

      const { error } = await supabase.from("applications").insert({
        id: applicationId,
        job_id: job.id,
        company_id: job.company_id,
        candidate_id: userId,
        expected_salary: Number(expectedSalary),
        available_from: availableFrom || null,
        cover_note: coverNote.trim() || null,
      });

      if (error) {
        console.error("[ApplyDialog] application insert failed", error);
        // No application was created, so drop the copy made for it.
        await supabase.storage.from("candidate-docs").remove([attachedPath]);
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
      const msg =
        e instanceof Error && e.message
          ? e.message
          : "Could not submit application. Please try again.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
      setUploading(false);
    }
  };

  const previewSaved = async (v: SavedVersion) => {
    setPreviewingKey(`v${v.version_number}`);
    try {
      const { url } = await versionPdfUrl({ data: { versionNumber: v.version_number } });
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPreview({
        url: URL.createObjectURL(await res.blob()),
        name: v.name?.trim() || `Version ${v.version_number}`,
        isImage: false,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't open this resume.");
    } finally {
      setPreviewingKey(null);
    }
  };
  const previewProfile = async () => {
    if (!existing) return;
    setPreviewingKey("profile");
    const p = await loadDocPreview(existing.path, existing.name);
    setPreviewingKey(null);
    if (p) setPreview(p);
  };
  const optionCls = (active: boolean) =>
    `rounded-lg border p-3 ${active ? "border-primary bg-primary/5" : "border-border bg-card"}`;

  const hasJobType = !!job.job_type;
  const hasWorkMode = !!job.work_mode;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        // Only a click that lands directly on the backdrop (never one that
        // bubbled up from inside the form) closes it — hover/cursor movement
        // over the backdrop never fires onClick, so this can't be triggered
        // by mouseleave/mouseout the way an outside-click listener could.
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-card shadow-2xl sm:flex-row sm:rounded-2xl">
        {/* Job summary — desktop only; the mobile bottom-sheet stays single-column
            (unchanged behavior) since the form itself already carries the job title. */}
        <div className="hidden w-72 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-surface/40 p-6 sm:flex">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <Building2 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold leading-snug text-foreground">{job.title}</h3>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {job.company_name || "Confidential employer"}
              {job.company_verified ? (
                <span className="ml-1 text-xs text-success">✓ Verified</span>
              ) : null}
            </p>
          </div>

          {(job.min_salary || job.max_salary) && (
            <p className="text-base font-bold text-foreground">
              {formatSalary(job.min_salary, job.max_salary, job.salary_period || "monthly")}
            </p>
          )}

          {((job.required_documents?.length ?? 0) > 0 ||
            (job.language_requirements?.length ?? 0) > 0) && (
            <div className="space-y-1 rounded-lg bg-primary-light px-3 py-2 text-xs text-foreground/80">
              {(job.required_documents?.length ?? 0) > 0 && (
                <p>
                  <span className="font-semibold text-primary">Keep ready: </span>
                  {job.required_documents!.join(", ")}
                </p>
              )}
              {(job.language_requirements?.length ?? 0) > 0 && (
                <p>
                  <span className="font-semibold text-primary">Languages: </span>
                  {job.language_requirements!.map((l) => `${l.language} (${l.level})`).join(", ")}
                </p>
              )}
            </div>
          )}

          {(hasJobType || hasWorkMode) && (
            <div className="flex flex-wrap gap-1.5">
              {hasJobType && (
                <Badge variant="info" className="rounded-full px-2.5 py-1 text-xs">
                  {jobTypeLabel(job.job_type as string)}
                </Badge>
              )}
              {hasWorkMode && (
                <Badge variant="muted" className="rounded-full px-2.5 py-1 text-xs">
                  {workModeLabel(job.work_mode as string)}
                </Badge>
              )}
            </div>
          )}

          {job.skills && job.skills.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {job.skills.slice(0, 4).map((s) => (
                <span
                  key={s}
                  className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground"
                >
                  {s}
                </span>
              ))}
            </div>
          )}

          <div className="mt-1 space-y-3 border-t border-border pt-4 text-sm">
            {job.created_at && (
              <div className="flex items-start gap-2.5">
                <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div>
                  <p className="text-muted-foreground">Posted on</p>
                  <p className="font-medium text-foreground">
                    {new Date(job.created_at).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                    })}
                  </p>
                </div>
              </div>
            )}
            {hasJobType && (
              <div className="flex items-start gap-2.5">
                <Briefcase className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div>
                  <p className="text-muted-foreground">Job type</p>
                  <p className="font-medium text-foreground">
                    {jobTypeLabel(job.job_type as string)}
                  </p>
                </div>
              </div>
            )}
            {hasWorkMode && (
              <div className="flex items-start gap-2.5">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div>
                  <p className="text-muted-foreground">Work mode</p>
                  <p className="font-medium text-foreground">
                    {workModeLabel(job.work_mode as string)}
                  </p>
                </div>
              </div>
            )}
            {(job.min_experience_years != null || job.max_experience_years != null) && (
              <div className="flex items-start gap-2.5">
                <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div>
                  <p className="text-muted-foreground">Experience required</p>
                  <p className="font-medium text-foreground">
                    {formatExperience(job.min_experience_years, job.max_experience_years)}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex items-start justify-between gap-4 border-b border-border p-5">
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-foreground">Apply to Job</h2>
              <p className="mt-0.5 truncate text-sm text-muted-foreground">{job.title}</p>
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
                <div className="rounded-xl border border-primary/20 bg-primary-light/50 p-3">
                  <p className="text-sm font-semibold text-foreground">
                    Resume <span className="text-destructive">*</span>
                  </p>
                  <div className="mt-2 space-y-2">
                    <div className={optionCls(mode === "saved")}>
                      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-foreground">
                        <input
                          type="radio"
                          name="resume-mode"
                          checked={mode === "saved"}
                          onChange={() => setMode("saved")}
                        />
                        Select saved resume
                      </label>
                      {mode === "saved" &&
                        (versions.length === 0 ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            No saved resumes yet.{" "}
                            <a
                              href="/candidate/resume-builder"
                              className="font-semibold text-primary hover:underline"
                            >
                              Create one in Resume Builder
                            </a>
                          </p>
                        ) : (
                          <ul className="mt-2 space-y-1.5">
                            {versions.map((v) => (
                              <li
                                key={v.version_number}
                                className="flex items-center gap-2 rounded-md bg-surface/60 px-2 py-1.5"
                              >
                                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                                  <input
                                    type="radio"
                                    name="resume-version"
                                    checked={selectedVersion === v.version_number}
                                    onChange={() => setSelectedVersion(v.version_number)}
                                  />
                                  <FileText className="h-4 w-4 shrink-0 text-primary" />
                                  <span className="min-w-0 truncate text-sm text-foreground">
                                    {v.name?.trim() || `Version ${v.version_number}`}
                                  </span>
                                </label>
                                <button
                                  type="button"
                                  onClick={() => previewSaved(v)}
                                  disabled={previewingKey === `v${v.version_number}`}
                                  className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary hover:underline disabled:opacity-60"
                                >
                                  {previewingKey === `v${v.version_number}` && (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  )}
                                  Preview
                                </button>
                              </li>
                            ))}
                          </ul>
                        ))}
                    </div>

                    <div className={optionCls(mode === "profile")}>
                      <label
                        className={`flex items-center gap-2 text-sm font-medium text-foreground ${existing ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
                      >
                        <input
                          type="radio"
                          name="resume-mode"
                          checked={mode === "profile"}
                          disabled={!existing}
                          onChange={() => setMode("profile")}
                        />
                        Use profile resume
                      </label>
                      {existing ? (
                        <div className="mt-2 flex items-center gap-2 rounded-md bg-surface/60 px-2 py-1.5">
                          <FileText className="h-4 w-4 shrink-0 text-primary" />
                          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                            {existing.name}
                          </span>
                          <button
                            type="button"
                            onClick={previewProfile}
                            disabled={previewingKey === "profile"}
                            className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary hover:underline disabled:opacity-60"
                          >
                            {previewingKey === "profile" && (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            )}
                            Preview
                          </button>
                        </div>
                      ) : (
                        <p className="mt-1 text-xs text-muted-foreground">
                          No resume on your profile yet.
                        </p>
                      )}
                    </div>

                    <div className={optionCls(mode === "upload")}>
                      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-foreground">
                        <input
                          type="radio"
                          name="resume-mode"
                          checked={mode === "upload"}
                          onChange={() => setMode("upload")}
                        />
                        Upload new resume
                      </label>
                      {mode === "upload" && (
                        <div className="mt-2">
                          {newFile ? (
                            <div className="flex items-center gap-2 rounded-md bg-surface/60 px-2 py-1.5">
                              <FileText className="h-4 w-4 shrink-0 text-primary" />
                              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                                {newFile.name}
                              </span>
                              <button
                                type="button"
                                onClick={() => setNewFile(null)}
                                className="text-xs font-semibold text-muted-foreground hover:text-destructive"
                              >
                                Remove
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={pickFile}
                              className="inline-flex h-9 items-center gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 text-sm font-semibold text-primary hover:bg-primary/10"
                            >
                              <Upload className="h-4 w-4" />
                              Choose file
                            </button>
                          )}
                          <p className="mt-1 text-xs text-muted-foreground">
                            PDF, DOC, DOCX, PNG or JPG · max 5 MB. Used for this application only;
                            your profile resume stays as it is.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                  {errors.resume && (
                    <p className="mt-1.5 text-xs font-medium text-destructive">{errors.resume}</p>
                  )}
                </div>
                <ApplicationFormFields
                  hideResume
                  resumeLabel=""
                  jobSalaryRange={{ min: job.min_salary, max: job.max_salary }}
                  expectedSalary={expectedSalary}
                  onExpectedSalaryChange={setExpectedSalary}
                  salaryError={errors.salary}
                  availableFrom={availableFrom}
                  onAvailableFromChange={setAvailableFrom}
                  availableError={errors.available}
                  minAvailableDate={new Date().toISOString().slice(0, 10)}
                  coverNote={coverNote}
                  onCoverNoteChange={setCoverNote}
                  coverError={errors.cover}
                />
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
      {preview && <DocumentPreviewModal preview={preview} onClose={() => setPreview(null)} />}
    </div>,
    document.body,
  );
}
