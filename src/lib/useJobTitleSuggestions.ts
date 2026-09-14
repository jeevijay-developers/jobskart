import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

let cache: string[] | null = null;
let inflight: Promise<string[]> | null = null;

function loadJobTitles(): Promise<string[]> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = (async () => {
      const { data, error } = await supabase
        .from("job_titles_master")
        .select("title")
        .eq("is_active", true)
        .order("title");
      inflight = null;
      if (error) {
        console.error("[useJobTitleSuggestions] load failed", error);
        return [];
      }
      const titles = (data ?? []).map((r) => r.title as string);
      cache = titles;
      return titles;
    })();
  }
  return inflight;
}

/**
 * Job title suggestions for search autocomplete, sourced from the public
 * `job_titles_master` table. The table is small (grows slowly via admin/user
 * additions) and publicly readable, so it's fetched once and cached in memory
 * rather than queried per keystroke.
 */
export function useJobTitleSuggestions(): string[] {
  const [titles, setTitles] = useState<string[]>(cache ?? []);

  useEffect(() => {
    if (cache) return;
    let cancelled = false;
    loadJobTitles().then((t) => {
      if (!cancelled) setTitles(t);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return titles;
}
