import { Eye, Download, Loader2 } from "lucide-react";
import type { ResumeSchema } from "@/lib/resumeBuilder/schema";

export interface VersionRow {
  id: string;
  version_number: number;
  template_id: string;
  created_at: string;
  snapshot: ResumeSchema;
}

interface VersionHistoryProps {
  versions: VersionRow[];
  versionsLoading: boolean;
  onPreview: (v: VersionRow) => void;
  onDownload: (v: VersionRow) => void;
  downloadingVersionId: string | null;
}

export function VersionHistory({
  versions,
  versionsLoading,
  onPreview,
  onDownload,
  downloadingVersionId,
}: VersionHistoryProps) {
  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Versions
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
                  <p className="text-xs font-semibold text-foreground">
                    Version {v.version_number}
                  </p>
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
              </div>
            ))}
          </>
        )}
      </div>
    </section>
  );
}
