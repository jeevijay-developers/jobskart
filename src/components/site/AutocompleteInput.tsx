import { useEffect, useId, useMemo, useRef, useState } from "react";
import { matchSuggestions } from "@/lib/autocomplete";

type Props = {
  value: string;
  onChange: (v: string) => void;
  /** Fires on Enter when no suggestion is keyboard-highlighted — hook up the existing "submit search" action here. */
  onSubmit?: () => void;
  suggestions: string[];
  minChars?: number;
  maxResults?: number;
  placeholder?: string;
  /** Classes for the position:relative wrapper — carry sizing (w-full, flex-1, min-w-0) to match the surrounding layout. */
  wrapperClassName?: string;
  /** Classes for the <input> itself — carry the existing visual styling. */
  inputClassName?: string;
  "aria-label"?: string;
};

/**
 * Self-contained typeahead: owns the input, dropdown positioning, and keyboard
 * nav, so it drops into any existing layout without the caller needing to add
 * `position: relative` itself. Selecting a suggestion fills the field only —
 * it does not trigger onSubmit.
 */
export function AutocompleteInput({
  value,
  onChange,
  onSubmit,
  suggestions,
  minChars = 2,
  maxResults = 8,
  placeholder,
  wrapperClassName = "relative",
  inputClassName,
  ...rest
}: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const results = useMemo(
    () => (value.trim().length >= minChars ? matchSuggestions(value, suggestions, maxResults) : []),
    [value, suggestions, minChars, maxResults],
  );

  useEffect(() => setActiveIndex(-1), [results]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setActiveIndex(-1);
  };

  const showDropdown = open && results.length > 0;

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown) {
      if (e.key === "Enter") onSubmit?.();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < results.length) pick(results[activeIndex].value);
      else onSubmit?.();
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  return (
    <div ref={containerRef} className={wrapperClassName}>
      <input
        {...rest}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined}
        className={inputClassName}
      />
      {showDropdown && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-lg border border-border bg-card py-1 shadow-lg"
        >
          {results.map((r, i) => (
            <li
              key={r.value}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === activeIndex}
            >
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(r.value)}
                onMouseEnter={() => setActiveIndex(i)}
                className={`block w-full px-3 py-2 text-left text-sm text-foreground ${i === activeIndex ? "bg-primary-light" : "hover:bg-surface"}`}
              >
                {r.segments.map((seg, si) =>
                  seg.matched ? (
                    <strong key={si} className="font-bold text-primary">
                      {seg.text}
                    </strong>
                  ) : (
                    <span key={si}>{seg.text}</span>
                  ),
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
