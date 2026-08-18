import { X, Plus, Check } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

export function SectionCard({ title, action, children, id }: { title: string; action?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)] sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground sm:text-lg">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-border bg-surface px-4 py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

export function Chip({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary-light px-3 py-1 text-xs font-medium text-primary">
      {label}
      {onRemove && (
        <button type="button" onClick={onRemove} className="rounded-full p-0.5 hover:bg-primary/10" aria-label={`Remove ${label}`}>
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

export function ChipInput({
  values,
  onChange,
  placeholder = "Type and press Enter",
  suggestions = [],
  max = 20,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
  max?: number;
}) {
  const [input, setInput] = useState("");
  const has = (v: string) => values.some((x) => x.toLowerCase() === v.trim().toLowerCase());
  const add = (v: string) => {
    const t = v.replace(/\s+/g, " ").trim();
    if (!t || has(t) || values.length >= max) return;
    onChange([...values, t]);
    setInput("");
  };
  const toggle = (v: string) => {
    if (has(v)) onChange(values.filter((x) => x.toLowerCase() !== v.trim().toLowerCase()));
    else add(v);
  };
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2">
        {values.map((v) => (
          <Chip key={v} label={v} onRemove={() => onChange(values.filter((x) => x !== v))} />
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(input);
            } else if (e.key === "Backspace" && !input && values.length) {
              onChange(values.slice(0, -1));
            }
          }}
          placeholder={values.length ? "" : placeholder}
          className="min-w-[120px] flex-1 bg-transparent px-1 py-1 text-sm outline-none"
        />
      </div>
      {suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {suggestions.slice(0, 15).map((s) => {
            const on = has(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(s)}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-surface text-foreground/70 hover:border-primary hover:text-primary"
                }`}
              >
                {on ? <Check className="h-3 w-3" strokeWidth={3} /> : <Plus className="h-3 w-3" />} {s}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Field({ label, hint, children, required }: { label: string; hint?: string; children: ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-foreground">
        {label} {required && <span className="text-destructive">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}
