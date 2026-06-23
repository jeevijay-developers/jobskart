import { useEffect, useRef, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { searchJobTitles, addCustomJobTitle } from "@/lib/candidate.functions";

type Props = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
};

export function JobTitleAutocomplete({ value, onChange, placeholder }: Props) {
  const [q, setQ] = useState(value);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const search = useServerFn(searchJobTitles);
  const addCustom = useServerFn(addCustomJobTitle);

  useEffect(() => setQ(value), [value]);

  useEffect(() => {
    if (q.trim().length < 3) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const id = setTimeout(async () => {
      try {
        const r = await search({ data: { q: q.trim() } });
        if (!cancelled) setResults(r);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [q, search]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const pick = (t: string) => {
    onChange(t);
    setQ(t);
    setOpen(false);
  };

  const canAddCustom =
    q.trim().length >= 3 &&
    !results.some((r) => r.toLowerCase() === q.trim().toLowerCase());

  const addCustomNow = async () => {
    const title = q.trim();
    if (title.length < 3) return;
    try {
      await addCustom({ data: { title } });
    } catch {
      /* ignore — still let the user proceed */
    }
    pick(title);
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        className="form-input"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder ?? "Start typing your job title…"}
        autoComplete="off"
      />
      {open && q.trim().length >= 3 && (
        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-border bg-card shadow-lg">
          {loading && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
            </div>
          )}
          {!loading &&
            results.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => pick(r)}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-surface"
              >
                {r}
              </button>
            ))}
          {!loading && canAddCustom && (
            <button
              type="button"
              onClick={addCustomNow}
              className="flex w-full items-center gap-1.5 border-t border-border px-3 py-2 text-left text-sm font-medium text-primary hover:bg-primary-light"
            >
              <Plus className="h-3.5 w-3.5" /> Add &ldquo;{q.trim()}&rdquo; as a new designation
            </button>
          )}
          {!loading && !canAddCustom && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">Type at least 3 characters</div>
          )}
        </div>
      )}
    </div>
  );
}
