import { useState } from "react";
import { Eye, Download, Loader2, Trash2, Pencil, FileEdit, Check, X } from "lucide-react";
import { MAX_RESUME_VERSIONS, RESUME_VERSION_NAME_MAX } from "@/lib/resumeBuilder/limits";
import type { ResumeSchema } from "@/lib/resumeBuilder/schema";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface VersionRow {
  id: string;
  version_number: number;
  template_id: string;
  created_at: string;
  name?: string | null;
  snapshot: ResumeSchema;
}

interface VersionHistoryProps {
  versions: VersionRow[];
  versionsLoading: boolean;
  onPreview: (v: VersionRow) => void;
  onDownload: (v: VersionRow) => void;
  onDelete: (v: VersionRow) => Promise<void>;
  /** Saves a new custom name ("" resets to "Version N"). */
  onRename: (v: VersionRow, name: string) => Promise<void>;
  /** Loads this version into the editor; saving then updates it instead of creating a new one. */
  onEdit: (v: VersionRow) => void;
  editingVersionNumber: number | null;
  /** Leaves edit mode: the next save creates a new version again. */
  onStopEditing: () => void;
  downloadingVersionId: string | null;
  deletingVersionId: string | null;
}

export function VersionHistory({
  versions,
  versionsLoading,
  onPreview,
  onDownload,
  onDelete,
  onRename,
  onEdit,
  editingVersionNumber,
  onStopEditing,
  downloadingVersionId,
  deletingVersionId,
}: VersionHistoryProps) {
  const [confirmTarget, setConfirmTarget] = useState<VersionRow | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [savingName, setSavingName] = useState(false);

  const startRename = (v: VersionRow) => {
    setRenamingId(v.id);
    setDraftName(v.name ?? `Version ${v.version_number}`);
  };
  const commitRename = async (v: VersionRow) => {
    setSavingName(true);
    try {
      // Saving the untouched default text keeps the version unnamed.
      const typed = draftName.trim();
      await onRename(v, typed === `Version ${v.version_number}` ? "" : typed);
      setRenamingId(null);
    } finally {
      setSavingName(false);
    }
  };

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Versions
        <span className="ml-2 normal-case tracking-normal">
          ({versions.length}/{MAX_RESUME_VERSIONS})
        </span>
      </h2>
      <div className="space-y-2">
        {versionsLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : versions.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center">No saved versions yet</p>
        ) : (
          <>
            {versions.map((v) => (
              <div
                key={v.id}
                className="flex items-center gap-3 rounded p-2 border border-border bg-background"
              >
                <div className="min-w-0 flex-1">
                  {renamingId === v.id ? (
                    <form
                      className="flex items-center gap-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void commitRename(v);
                      }}
                    >
                      <input
                        autoFocus
                        value={draftName}
                        maxLength={RESUME_VERSION_NAME_MAX}
                        onChange={(e) => setDraftName(e.target.value)}
                        onKeyDown={(e) => e.key === "Escape" && setRenamingId(null)}
                        aria-label="Resume version name"
                        className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-2 text-xs"
                      />
                      <button
                        type="submit"
                        disabled={savingName}
                        className="rounded p-1 text-primary hover:bg-surface"
                        title="Save name"
                      >
                        {savingName ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenamingId(null)}
                        className="rounded p-1 text-muted-foreground hover:bg-surface"
                        title="Cancel"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </form>
                  ) : (
                    <p className="truncate text-xs font-semibold text-foreground">
                      {v.name?.trim() || `Version ${v.version_number}`}
                      {editingVersionNumber === v.version_number && (
                        <button
                          type="button"
                          onClick={onStopEditing}
                          title="Stop editing (the next save creates a new version)"
                          className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/20"
                        >
                          Editing ✕
                        </button>
                      )}
                    </p>
                  )}
                  <p className="text-[10px] text-muted-foreground">
                    {new Date(v.created_at).toLocaleString("en-IN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                    {` · `}
                    {v.template_id}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => startRename(v)}
                  className="rounded p-1.5 text-muted-foreground hover:bg-surface hover:text-foreground"
                  title="Rename this version"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onEdit(v)}
                  className="rounded p-1.5 text-muted-foreground hover:bg-surface hover:text-foreground"
                  title="Edit this version"
                >
                  <FileEdit className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onPreview(v)}
                  className="rounded p-1.5 text-muted-foreground hover:bg-surface hover:text-foreground"
                  title="Preview this version"
                >
                  <Eye className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onDownload(v)}
                  disabled={downloadingVersionId === v.id}
                  className={`rounded p-1.5 text-muted-foreground hover:bg-surface hover:text-foreground ${
                    downloadingVersionId === v.id ? "opacity-50" : ""
                  }`}
                  title="Download this version"
                >
                  {downloadingVersionId === v.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmTarget(v)}
                  disabled={deletingVersionId === v.id}
                  className={`rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive ${
                    deletingVersionId === v.id ? "opacity-50" : ""
                  }`}
                  title="Delete this version"
                >
                  {deletingVersionId === v.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            ))}
          </>
        )}
      </div>

      <AlertDialog open={!!confirmTarget} onOpenChange={(open) => !open && setConfirmTarget(null)}>
        <AlertDialogContent className="max-lg:w-[calc(100%-2rem)] max-lg:max-w-sm max-lg:rounded-2xl max-lg:p-5 max-lg:text-center">
          <AlertDialogHeader className="max-lg:space-y-3">
            <AlertDialogTitle>Delete resume version?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this resume version?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="max-lg:flex-col-reverse max-lg:gap-2">
            <AlertDialogCancel className="max-lg:!mt-0 max-lg:w-full">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="max-lg:w-full"
              onClick={async () => {
                if (!confirmTarget) return;
                const target = confirmTarget;
                setConfirmTarget(null);
                await onDelete(target);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
