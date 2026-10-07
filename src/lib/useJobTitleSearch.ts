import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { searchJobTitles } from "@/lib/candidate.functions";

/**
 * Server-side title search (same `searchJobTitles` server function the Job Posting
 * form uses): the typed text is sent after a 250 ms debounce, only matches come back
 * (max `limit`), stale requests are ignored, and failures yield no suggestions.
 */
export function useJobTitleSearch(query: string, minChars = 3, limit = 10): string[] {
  const search = useServerFn(searchJobTitles);
  const [results, setResults] = useState<string[]>([]);
  const q = query.trim();

  useEffect(() => {
    if (q.length < minChars) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const id = setTimeout(async () => {
      try {
        const r = await search({ data: { q } });
        if (!cancelled) setResults(r.slice(0, limit));
      } catch {
        if (!cancelled) setResults([]);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [q, minChars, limit, search]);

  return results;
}
