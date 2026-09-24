import { ChevronDown } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export function OptionalSection({
  title,
  summary,
  badge,
  hasValues = false,
  defaultOpen = false,
  children,
  className,
}: {
  title: ReactNode;
  /** Shown on the trigger row while the section is closed. */
  summary?: string;
  /** Count of filled fields inside; rendered as a chip on the trigger row. */
  badge?: number;
  /** Force-open when any inner field has a value (edit-mode hydration). */
  hasValues?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen || hasValues);

  useEffect(() => {
    if (hasValues) setOpen(true);
  }, [hasValues]);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={`rounded-xl border border-border bg-surface/60 ${className ?? ""}`}>
      <CollapsibleTrigger asChild>
        <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
          <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
            <span className="truncate">{title}</span>
            {badge ? (
              <span className="shrink-0 rounded-full bg-primary-light px-2 py-0.5 text-[11px] font-bold tabular-nums text-primary">
                {badge} filled
              </span>
            ) : null}
          </span>
          <span className="flex shrink-0 items-center gap-2 text-xs font-medium text-muted-foreground">
            {!open && summary ? <span className="hidden sm:inline">{summary}</span> : null}
            <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="collapsible-content">
        <div className="space-y-4 px-4 pb-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
