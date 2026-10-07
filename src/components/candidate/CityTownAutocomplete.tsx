import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

type Props = {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  disabled?: boolean;
  placeholder?: string;
  showDropdownIndicator?: boolean;
  // Opt-in: suppresses the dropdown (including the "show all on focus" case)
  // until at least this many characters are typed. Defaults to 0 so existing
  // callers (City/Town, which show the full list on focus) are unaffected.
  minChars?: number;
  // Opt-in cap on how many suggestions render at once. Defaults to unlimited
  // so existing callers keep their current list length.
  maxSuggestions?: number;
  // Opt-in: 44px minimum tap height for each suggestion row (mobile tap targets).
  tallRows?: boolean;
  // Opt-in: marks the input as required for assistive tech.
  required?: boolean;
};

/** Editable combobox: local suggestions filtered as-you-type, but any typed value is accepted as-is. */
export function CityTownAutocomplete({
  value,
  onChange,
  suggestions,
  disabled,
  placeholder,
  showDropdownIndicator = false,
  minChars = 0,
  maxSuggestions,
  tallRows = false,
  required = false,
}: Props) {
  const [q, setQ] = useState(value);
  const [open, setOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const MENU_MAX_HEIGHT = 272; // keep in sync with the themed Select dropdowns (State/Gender)

  useEffect(() => setQ(value), [value]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Flip upward only when there isn't room below, same collision-aware behavior as the Radix selects.
  useLayoutEffect(() => {
    if (!open || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    setOpenUpward(spaceBelow < MENU_MAX_HEIGHT + 16 && rect.top > spaceBelow);
  }, [open]);

  const meetsMinChars = q.trim().length >= minChars;
  const matched = q.trim()
    ? suggestions.filter((s) => s.toLowerCase().includes(q.trim().toLowerCase()))
    : suggestions;
  // Dedupe (case-insensitive) before capping, so the count limit reflects
  // what's actually shown rather than being skewed by duplicate entries.
  const deduped = Array.from(new Map(matched.map((s) => [s.toLowerCase(), s])).values());
  const filtered = meetsMinChars
    ? typeof maxSuggestions === "number"
      ? deduped.slice(0, maxSuggestions)
      : deduped
    : [];

  useEffect(() => setHighlighted(-1), [q, open]);

  const pick = (t: string) => {
    onChange(t);
    setQ(t);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        className={`form-input disabled:cursor-not-allowed disabled:opacity-60 ${showDropdownIndicator ? "pr-10" : ""}`}
        value={q}
        disabled={disabled}
        aria-required={required || undefined}
        onChange={(e) => {
          setQ(e.target.value);
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => !disabled && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            return;
          }
          if (!open || filtered.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            e.stopPropagation();
            setHighlighted((i) => (i + 1) % filtered.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            setHighlighted((i) => (i <= 0 ? filtered.length - 1 : i - 1));
          } else if (e.key === "Enter" && highlighted >= 0) {
            e.preventDefault();
            e.stopPropagation();
            pick(filtered[highlighted]);
          }
        }}
        placeholder={
          disabled ? "Select a state first" : (placeholder ?? "Select or type city/town")
        }
        autoComplete="off"
      />
      {showDropdownIndicator && (
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      )}
      {open && !disabled && filtered.length > 0 && (
        <div
          className={`absolute z-[100] w-full overflow-y-auto overflow-x-hidden rounded-xl border border-primary/15 bg-popover shadow-xl shadow-primary/10 [scrollbar-width:thin] ${
            openUpward ? "bottom-full mb-1" : "top-full mt-1"
          }`}
          style={{ maxHeight: MENU_MAX_HEIGHT }}
        >
          {filtered.map((s, i) => (
            <button
              key={s}
              type="button"
              onClick={() => pick(s)}
              className={`block w-full px-3 py-2 text-left text-sm hover:bg-surface ${tallRows ? "min-h-11" : ""} ${
                i === highlighted ? "bg-surface" : ""
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
