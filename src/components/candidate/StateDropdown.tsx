import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

type Props = {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  placeholder?: string;
  /** Overrides the trigger button's className (default: the standard form-input look). */
  triggerClassName?: string;
  /** Overrides the open menu's max-height in px (default: 272). */
  maxMenuHeight?: number;
};

/**
 * Same visible-scrollbar dropdown treatment as CityTownAutocomplete (a plain
 * overflow-y-auto list, not Radix Select — Radix always hides its native
 * scrollbar in favor of up/down arrow buttons, which can't be made to match
 * City/Town's look without touching the shared ThemedSelect used elsewhere).
 */
export function StateDropdown({
  value,
  onChange,
  options,
  placeholder = "Select state",
  triggerClassName,
  maxMenuHeight,
}: Props) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<
    { left: number; width: number } & ({ top: number; bottom?: undefined } | { top?: undefined; bottom: number })
  >();
  const containerRef = useRef<HTMLDivElement>(null);
  const MENU_MAX_HEIGHT = maxMenuHeight ?? 272; // matches CityTownAutocomplete / ThemedSelect dropdowns by default

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Positioned as position: fixed with coordinates read straight off the
  // trigger's own screen rect, instead of position: absolute inside the
  // field's flow. An absolutely positioned element shouldn't affect layout
  // height in principle, but this field commonly sits inside a CSS grid row
  // (paired with another field) — some browsers still reserve/stretch grid
  // track height around a long absolutely-positioned descendant in a way
  // that visibly grows the page. Fixed positioning removes it from the
  // layout entirely, so the open menu can never change document height,
  // regardless of container/grid quirks.
  useLayoutEffect(() => {
    if (!open || !containerRef.current) return;
    const updatePosition = () => {
      const rect = containerRef.current!.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      // Only flip upward when there's genuinely too little room below to show
      // even a small scrollable menu, AND opening upward would clearly help —
      // this field commonly sits mid-page in a long, normally-scrollable form,
      // where "less than the full menu height" below is the everyday case, not
      // a real collision. Flipping there just makes the menu cover content
      // above it instead. A much smaller floor (~120px, enough for a few rows)
      // keeps the default "open below" behavior for that everyday case.
      const MIN_USABLE_HEIGHT = 120;
      const openUpward = spaceBelow < MIN_USABLE_HEIGHT && spaceAbove > spaceBelow;
      setMenuPos(
        openUpward
          ? { bottom: window.innerHeight - rect.top + 4, left: rect.left, width: rect.width }
          : { top: rect.bottom + 4, left: rect.left, width: rect.width },
      );
    };
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
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
      {open && menuPos && (
        <div
          className="fixed z-[100] overflow-y-auto overflow-x-hidden rounded-xl border border-primary/15 bg-popover shadow-xl shadow-primary/10 [scrollbar-width:thin] box-border"
          style={{
            top: menuPos.top,
            bottom: menuPos.bottom,
            left: menuPos.left,
            width: menuPos.width,
            maxHeight: MENU_MAX_HEIGHT,
          }}
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
