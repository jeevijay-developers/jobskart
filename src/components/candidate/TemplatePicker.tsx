import { RESUME_TEMPLATE_LIST } from "@/lib/resumeBuilder/templates/registry";
import { FileText, CheckCircle2 } from "lucide-react";

interface TemplatePickerProps {
  selectedTemplate: string;
  onSelect: (id: string) => void;
}

export function TemplatePicker({ selectedTemplate, onSelect }: TemplatePickerProps) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Choose Template
      </h2>
      <div className="flex flex-col gap-3">
        {RESUME_TEMPLATE_LIST.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(t.id)}
            className={`relative flex items-start gap-3 rounded-xl border-2 p-4 text-left transition-all ${
              selectedTemplate === t.id
                ? "border-primary bg-primary/5"
                : "border-border bg-background hover:border-primary/40 hover:bg-surface"
            }`}
          >
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <FileText className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{t.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
            </div>
            {selectedTemplate === t.id && (
              <CheckCircle2 className="absolute right-3 top-3 h-4 w-4 text-primary" />
            )}
          </button>
        ))}
      </div>
    </section>
  );
}
