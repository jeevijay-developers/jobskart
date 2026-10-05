import { X, Loader2, RotateCcw, ArrowLeft } from "lucide-react";
import { Segmented } from "./Segmented";
import { ResumeLayoutEditor } from "./ResumeLayoutEditor";
import { ResumeExtrasEditor } from "./ResumeExtrasEditor";
import type {
  ResumeLayoutSettings,
  ResumeExtras,
  ExperienceItem,
} from "@/lib/resumeBuilder/schema";

interface EditModeDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: "layout" | "extras";
  setActiveTab: (tab: "layout" | "extras") => void;
  layoutDraft: ResumeLayoutSettings;
  setLayoutDraft: (value: ResumeLayoutSettings) => void;
  extras: ResumeExtras;
  setExtras: (value: ResumeExtras) => void;
  experiences: ExperienceItem[];
  sections: { id: string; title: string }[];
  onSave: () => void;
  isSaving: boolean;
  isDirty: boolean;
  onReset: () => void;
}

export function EditModeDrawer({
  isOpen,
  onClose,
  activeTab,
  setActiveTab,
  layoutDraft,
  setLayoutDraft,
  extras,
  setExtras,
  experiences,
  sections,
  onSave,
  isSaving,
  isDirty,
  onReset,
}: EditModeDrawerProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-80 bg-card border-l border-border shadow-lg z-50">
      <div className="flex flex-col h-full space-y-4 p-4">
        <div className="flex items-center justify-between pb-2 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Edit Resume</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            aria-label="Close edit mode"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <Segmented
          fullWidth
          value={activeTab}
          options={[
            { value: "layout", label: "Layout" },
            { value: "extras", label: "Content" },
          ]}
          onChange={setActiveTab}
        />

        {/* Only this region scrolls, so the header, tabs and Back/Save footer stay in view. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {activeTab === "layout" ? (
            <ResumeLayoutEditor value={layoutDraft} onChange={setLayoutDraft} className="flex-1" />
          ) : (
            <ResumeExtrasEditor
              extras={extras}
              onChange={setExtras}
              experiences={experiences}
              sections={sections}
              className="flex-1"
            />
          )}
        </div>

        <div className="flex items-center justify-between gap-2 pt-3 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            aria-label="Back"
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground hover:bg-surface"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex h-9 items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!isDirty || isSaving}
            className={`inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-sm transition-all
               ${isSaving ? "" : "hover:bg-primary/90"}
               ${!isDirty || isSaving ? "opacity-50" : ""}`}
          >
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
