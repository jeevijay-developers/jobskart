import { useEffect, useLayoutEffect, useRef, useState } from "react";

type Props = {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  disabled?: boolean;
  placeholder?: string;
};

/** Editable combobox: local suggestions filtered as-you-type, but any typed value is accepted as-is. */
export function CityTownAutocomplete({ value, onChange, suggestions, disabled, placeholder }: Props) {
  const [q, setQ] = useState(value);
  const [open, setOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
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

  const filtered = q.trim()
    ? suggestions.filter((s) => s.toLowerCase().includes(q.trim().toLowerCase()))
    : suggestions;

  const pick = (t: string) => {
    onChange(t);
    setQ(t);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        className="form-input disabled:cursor-not-allowed disabled:opacity-60"
        value={q}
        disabled={disabled}
        onChange={(e) => {
          setQ(e.target.value);
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => !disabled && setOpen(true)}
        placeholder={disabled ? "Select a state first" : (placeholder ?? "Select or type city/town")}
        autoComplete="off"
      />
      {open && !disabled && filtered.length > 0 && (
        <div
          className={`absolute z-[100] w-full overflow-y-auto overflow-x-hidden rounded-xl border border-primary/15 bg-popover shadow-xl shadow-primary/10 [scrollbar-width:thin] ${
            openUpward ? "bottom-full mb-1" : "top-full mt-1"
          }`}
          style={{ maxHeight: MENU_MAX_HEIGHT }}
        >
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => pick(s)}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-surface"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
