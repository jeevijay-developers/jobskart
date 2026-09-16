import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

type Props = {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  placeholder?: string;
  /** Overrides the trigger button's className (default: the standard form-input look). */
  triggerClassName?: string;
};

/**
 * Same visible-scrollbar dropdown treatment as CityTownAutocomplete (a plain
 * overflow-y-auto list, not Radix Select — Radix always hides its native
 * scrollbar in favor of up/down arrow buttons, which can't be made to match
 * City/Town's look without touching the shared ThemedSelect used elsewhere).
 */
export function StateDropdown({ value, onChange, options, placeholder = "Select state", triggerClassName }: Props) {
  const [open, setOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const MENU_MAX_HEIGHT = 272; // matches CityTownAutocomplete / ThemedSelect dropdowns

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useLayoutEffect(() => {
    if (!open || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    setOpenUpward(spaceBelow < MENU_MAX_HEIGHT + 16 && rect.top > spaceBelow);
  }, [open]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className={triggerClassName ?? "form-input flex items-center justify-between text-left"}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={value ? "" : "text-muted-foreground"}>{value || placeholder}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div
          className={`absolute z-[100] w-full overflow-y-auto overflow-x-hidden rounded-xl border border-primary/15 bg-popover shadow-xl shadow-primary/10 [scrollbar-width:thin] ${
            openUpward ? "bottom-full mb-1" : "top-full mt-1"
          }`}
          style={{ maxHeight: MENU_MAX_HEIGHT }}
        >
          {options.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => pick(s)}
              className={`block w-full px-3 py-2 text-left text-sm hover:bg-surface ${
                s === value ? "bg-primary/10 font-medium text-primary" : ""
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
