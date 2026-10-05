import { X, Loader2, RotateCcw, ArrowLeft } from "lucide-react";
import { ResumeLayoutEditor } from "./ResumeLayoutEditor";
import { ResumeExtrasEditor } from "./ResumeExtrasEditor";
import type {
  ResumeLayoutSettings,
  ResumeExtras,
  ExperienceItem,
} from "@/lib/resumeBuilder/schema";

interface EditModeBottomSheetProps {
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

export function EditModeBottomSheet({
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
}: EditModeBottomSheetProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50">
      <div className="flex max-h-[82dvh] flex-col gap-2 overflow-hidden rounded-t-2xl bg-card px-3 pb-2 pt-1.5 shadow-xl">
        {/* Drag handle */}
        <div className="flex shrink-0 justify-center">
          <div className="w-4 h-0.5 bg-muted-foreground/20 rounded" />
        </div>

        <div className="flex shrink-0 items-center justify-between border-b border-border pb-1.5">
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

        <div
          className="flex w-full shrink-0 overflow-hidden rounded-lg border border-border"
          role="tablist"
          aria-label="Resume editor tabs"
        >
          {([
            ["layout", "Layout"],
            ["extras", "Content"],
          ] as const).map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={(event) => {
                // The sheet stays mounted while only the controlled editor tab changes.
                // Stopping propagation keeps this mobile control isolated from page-level clicks.
                event.preventDefault();
                event.stopPropagation();
                setActiveTab(tab);
              }}
              className={`min-w-0 flex-1 px-3 py-2 text-center text-xs font-medium ${
                activeTab === tab
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-surface"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Only this region scrolls (same as the desktop drawer), so the header, tabs and
            Back/Save footer stay in view. */}
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pr-0.5">
          {activeTab === "layout" ? (
            <ResumeLayoutEditor
              value={layoutDraft}
              onChange={setLayoutDraft}
              className="flex-1 !rounded-none !border-0 !bg-transparent !p-0 !shadow-none"
            />
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

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border pt-1.5">
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
