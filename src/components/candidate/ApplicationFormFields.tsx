import { FileText, Loader2, Upload } from "lucide-react";

type Props = {
  readOnly?: boolean;

  resumeLabel: string;
  resumeSubLabel?: string;
  resumeError?: string;
  showRemoveResume?: boolean;
  onPickResume?: () => void;
  onRemoveResume?: () => void;
  onViewResume?: () => void;
  viewingResume?: boolean;

  jobSalaryRange?: { min: number | null; max: number | null };
  expectedSalary: string;
  onExpectedSalaryChange?: (v: string) => void;
  salaryError?: string;

  availableFrom: string;
  onAvailableFromChange?: (v: string) => void;
  availableError?: string;
  minAvailableDate?: string;

  coverNote: string;
  onCoverNoteChange?: (v: string) => void;
  coverError?: string;
};

/**
 * Renders the "Resume / expected salary / available from / cover note" fields shared
 * by the apply flow (editable) and the read-only "view application" review. Keeping
 * this in one place avoids a parallel, copy-pasted form for the read-only view.
 */
export function ApplicationFormFields({
  readOnly = false,
  resumeLabel,
  resumeSubLabel,
  resumeError,
  showRemoveResume,
  onPickResume,
  onRemoveResume,
  onViewResume,
  viewingResume,
  jobSalaryRange,
  expectedSalary,
  onExpectedSalaryChange,
  salaryError,
  availableFrom,
  onAvailableFromChange,
  availableError,
  minAvailableDate,
  coverNote,
  onCoverNoteChange,
  coverError,
}: Props) {
  return (
    <>
      {/* Resume */}
      <div>
        <label className="text-sm font-semibold text-foreground">
          Resume {!readOnly && <span className="text-destructive">*</span>}
        </label>
        {!readOnly && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            PDF, DOC, DOCX, PNG or JPG · max 5 MB
          </p>
        )}

        {resumeLabel ? (
          <div className="mt-2 flex items-center gap-3 rounded-lg border border-border bg-surface/60 p-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
              <FileText className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{resumeLabel}</p>
              {resumeSubLabel && <p className="text-xs text-muted-foreground">{resumeSubLabel}</p>}
            </div>
            {readOnly && onViewResume && (
              <button
                type="button"
                onClick={onViewResume}
                disabled={viewingResume}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline disabled:opacity-60"
              >
                {viewingResume && <Loader2 className="h-3 w-3 animate-spin" />}
                View resume
              </button>
            )}
            {!readOnly && showRemoveResume && (
              <button
                type="button"
                onClick={onRemoveResume}
                className="text-xs font-semibold text-muted-foreground hover:text-destructive"
              >
                Remove
              </button>
            )}
          </div>
        ) : readOnly ? (
          <p className="mt-2 text-sm text-muted-foreground">No resume on file.</p>
        ) : null}

        {!readOnly && onPickResume && (
          <button
            type="button"
            onClick={onPickResume}
            className="mt-2 inline-flex h-10 items-center gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-4 text-sm font-semibold text-primary hover:bg-primary/10"
          >
            <Upload className="h-4 w-4" />
            {resumeLabel ? "Upload a different resume" : "Upload resume"}
          </button>
        )}
        {resumeError && (
          <p className="mt-1.5 text-xs font-medium text-destructive">{resumeError}</p>
        )}
      </div>

      {/* Salary + available from */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-semibold text-foreground">
            Expected salary (₹/month) {!readOnly && <span className="text-destructive">*</span>}
          </label>
          {readOnly ? (
            <p className="mt-1.5 text-sm font-medium text-foreground">
              {expectedSalary ? `₹${Number(expectedSalary).toLocaleString("en-IN")}/month` : "—"}
            </p>
          ) : (
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={expectedSalary}
              onChange={(e) => onExpectedSalaryChange?.(e.target.value)}
              placeholder="e.g. 35000"
              className="mt-1 h-10 w-full rounded-lg border border-input bg-card px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          )}
          {!readOnly && (jobSalaryRange?.min || jobSalaryRange?.max) ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Job range: ₹{(jobSalaryRange?.min ?? 0).toLocaleString("en-IN")} – ₹
              {(jobSalaryRange?.max ?? 0).toLocaleString("en-IN")} /month
            </p>
          ) : null}
          {salaryError && (
            <p className="mt-1 text-xs font-medium text-destructive">{salaryError}</p>
          )}
        </div>
        <div>
          <label className="text-sm font-semibold text-foreground">Available from</label>
          {readOnly ? (
            <p className="mt-1.5 text-sm font-medium text-foreground">
              {availableFrom
                ? new Date(availableFrom).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })
                : "—"}
            </p>
          ) : (
            <input
              type="date"
              value={availableFrom}
              min={minAvailableDate}
              onChange={(e) => onAvailableFromChange?.(e.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-input bg-card px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          )}
          {availableError && (
            <p className="mt-1 text-xs font-medium text-destructive">{availableError}</p>
          )}
        </div>
      </div>

      {/* Cover note */}
      <div>
        <label className="text-sm font-semibold text-foreground">
          Cover note{" "}
          {!readOnly && (
            <span className="text-xs font-normal text-muted-foreground">(optional)</span>
          )}
        </label>
        {readOnly ? (
          <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-surface p-3 text-sm text-foreground">
            {coverNote || <span className="text-muted-foreground">No cover note added.</span>}
          </p>
        ) : (
          <>
            <textarea
              rows={4}
              value={coverNote}
              onChange={(e) => onCoverNoteChange?.(e.target.value.slice(0, 1000))}
              placeholder="Tell the employer why you're a great fit…"
              className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
              <span className={coverError ? "text-destructive font-medium" : ""}>
                {coverError || " "}
              </span>
              <span>{coverNote.length}/1000</span>
            </div>
          </>
        )}
      </div>
    </>
  );
}
