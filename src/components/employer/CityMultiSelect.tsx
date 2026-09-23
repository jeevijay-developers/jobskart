import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

type Props = {
  options: string[];
  selected: string[];
  onAdd: (city: string) => void;
  placeholder?: string;
};

/**
 * Click-to-open, searchable, scrollable city picker — same interaction shape
 * as CityTownAutocomplete (search field, scrollable list, collision-aware
 * up/down flip) but for adding to a multi-select chip list instead of
 * replacing a single field value. Already-selected cities are filtered out
 * of the list (they're shown as removable chips by the caller).
 */
export function CityMultiSelect({ options, selected, onAdd, placeholder = "+ Add city" }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [openUpward, setOpenUpward] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const MENU_MAX_HEIGHT = 272; // keep in sync with CityTownAutocomplete / themed Select dropdowns

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
    searchRef.current?.focus();
  }, [open]);

  // Reset the search text whenever the dropdown closes, no matter how it
  // closed (outside click or selecting a city) — every fresh open must
  // start from a blank "Search city..." field, never a stale query.
  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  const available = options.filter((c) => c && !selected.includes(c));
  const filtered = q.trim()
    ? available.filter((c) => c.toLowerCase().includes(q.trim().toLowerCase()))
    : available;

  const pick = (city: string) => {
    // TEMP DEBUG — remove after root cause found
    console.log("[CityMultiSelect] pick() called with:", city);
    onAdd(city);
    setOpen(false);
    // TEMP DEBUG — remove after root cause found
    console.log("[CityMultiSelect] onAdd fired, closing dropdown");
    // q is cleared by the `open` effect above.
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // TEMP DEBUG — remove after root cause found
    console.log("[CityMultiSelect] onSearchKeyDown fired, key:", e.key, "q:", JSON.stringify(q));
    if (e.key !== "Enter") return;
    // This search field lives inside the page's search <form> — without
    // both of these, Enter here would submit the whole Candidate Database
    // search instead of just picking a city.
    e.preventDefault();
    e.stopPropagation();
    const query = q.trim().toLowerCase();
    const exact = available.find((c) => c.toLowerCase() === query);
    const cityToSelect = exact ?? filtered[0];
    // TEMP DEBUG — remove after root cause found
    console.log("[CityMultiSelect] Enter pressed:", {
      query,
      availableCount: available.length,
      filtered,
      exact,
      cityToSelect,
    });
    if (!cityToSelect) {
      console.log("[CityMultiSelect] no city to select, aborting");
      return;
    }
    pick(cityToSelect);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 w-full items-center justify-between rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
      >
        <span className="truncate text-left text-foreground/80">{placeholder} ({selected.length})</span>
      </button>
      {open && (
        <div
          className={`absolute left-0 right-0 z-[100] overflow-hidden rounded-xl border border-primary/15 bg-popover shadow-xl shadow-primary/10 ${
            openUpward ? "bottom-full mb-1" : "top-full mt-1"
          }`}
        >
          <div className="relative border-b border-border p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="Search city..."
              className="form-input h-9 pl-8 text-sm"
              autoComplete="off"
            />
          </div>
          <div className="overflow-y-auto overflow-x-hidden [scrollbar-width:thin]" style={{ maxHeight: MENU_MAX_HEIGHT }}>
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted-foreground">No matching cities.</p>
            ) : (
              filtered.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => pick(c)}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-surface"
                >
                  {c}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
