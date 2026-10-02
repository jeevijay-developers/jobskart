import { Edit } from "lucide-react";

interface EditModeTriggerProps {
  isEditOpen: boolean;
  onToggle: () => void;
}

export function EditModeTrigger({ isEditOpen, onToggle }: EditModeTriggerProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-2 rounded-xl border-2 p-4 text-left transition-all border-border bg-background hover:border-primary/40 hover:bg-surface"
      aria-label="Edit resume"
    >
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <Edit className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">Edit Resume</p>
      </div>
    </button>
  );
}
