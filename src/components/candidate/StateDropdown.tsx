import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  /**
   * Opt-in: minimum menu width in px for a trigger narrower than its options. The
   * menu then aligns its right edge with the trigger (staying on screen) instead of
   * clipping option text to the trigger's width.
   */
  menuMinWidth?: number;
  /** Opt-in: shows a search box atop the menu that filters options as you type. */
  searchable?: boolean;
  /** Placeholder for the search box (searchable only). Default: "Search…". */
  searchPlaceholder?: string;
  /** Render an anchored menu inside a parent dialog's DOM tree. */
  portalToBody?: boolean;
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
  menuMinWidth,
  searchable,
  searchPlaceholder = "Search…",
  portalToBody = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [menuPos, setMenuPos] = useState<
    { left: number; width: number } & ({ top: number; bottom?: undefined } | { top?: undefined; bottom: number })
  >();
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const MENU_MAX_HEIGHT = maxMenuHeight ?? 272; // matches CityTownAutocomplete / ThemedSelect dropdowns by default
  const visibleOptions = searchable && search.trim()
    ? options.filter((s) => s.toLowerCase().includes(search.trim().toLowerCase()))
    : options;

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      // The menu is portaled to document.body (see below), so it's not a DOM
      // descendant of containerRef — check it separately or every click
      // inside the open menu would be treated as "outside" and close it
      // before the option's own onClick can fire.
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
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
      const wide = !!menuMinWidth && rect.width < menuMinWidth;
      const width = wide ? menuMinWidth : rect.width;
      const left = wide ? Math.max(8, rect.right - width) : rect.left;
      setMenuPos(
        openUpward
          ? { bottom: window.innerHeight - rect.top + 4, left, width }
          : { top: rect.bottom + 4, left, width },
      );
    };
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, menuMinWidth]);

  const pick =(v: string) => {
    onChange(v);
    setOpen(false);
    setSearch("");
  };

  useEffect(() => {
    if (open && searchable) searchRef.current?.focus();
    if (!open) setSearch("");
  }, [open, searchable]);

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
      {open && (portalToBody ? menuPos : true) && (() => {
        const menu = (
          <div
            ref={menuRef}
            data-portal-dropdown={portalToBody || undefined}
            className={`${portalToBody ? "fixed" : "absolute"} z-[100] flex flex-col overflow-hidden rounded-xl border border-primary/15 bg-popover shadow-xl shadow-primary/10 box-border`}
            style={
              portalToBody
                ? {
                    top: menuPos?.top,
                    bottom: menuPos?.bottom,
                    left: menuPos?.left,
                    width: menuPos?.width,
                    maxHeight: MENU_MAX_HEIGHT,
                    // Radix's Dialog sets document.body.style.pointerEvents = "none"
                    // while modal (re-enabling "auto" only on the overlay/content
                    // nodes it manages). This menu is portaled straight to
                    // document.body too, so without this override it silently
                    // inherits "none" and every option becomes unclickable — even
                    // though it's visually on top, z-index doesn't matter once an
                    // element is pointer-events:none.
                    pointerEvents: "auto",
                  }
                : {
                    top: "calc(100% + 4px)",
                    left: 0,
                    width: "100%",
                    maxHeight: MENU_MAX_HEIGHT,
                  }
            }
          >
            {searchable && (
              <div className="shrink-0 border-b border-border p-1.5">
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="form-input w-full text-sm"
                />
              </div>
            )}
            <div className="min-h-0 overflow-y-auto overflow-x-hidden [scrollbar-width:thin]">
              {visibleOptions.length === 0 && (
                <div className="px-3 py-2 text-sm text-muted-foreground">No matches</div>
              )}
              {visibleOptions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onMouseDown={() => pick(s)}
                  className={`block w-full px-3 py-2 text-left text-sm hover:bg-surface ${
                    s === value ? "bg-primary/10 font-medium text-primary" : ""
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        );

        return portalToBody ? createPortal(menu, document.body) : menu;
      })()}
    </div>
  );
}
