import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/**
 * Tracks and toggles whether `userId` has bookmarked `jobId` in `saved_jobs`.
 * Mirrors the toggle logic already used on the job detail page so JobCard can
 * offer the same "Save job" action from listing/search/saved views.
 */
export function useSavedJob(jobId: string, userId: string | null) {
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setSaved(false);
      setReady(true);
      return;
    }
    setReady(false);
    supabase
      .from("saved_jobs")
      .select("id")
      .eq("job_id", jobId)
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setSaved(!!data);
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, userId]);

  const toggle = async () => {
    if (!userId || loading) return;
    const next = !saved;
    setSaved(next); // optimistic
    setLoading(true);
    try {
      if (next) {
        const { error } = await supabase.from("saved_jobs").insert({ job_id: jobId, user_id: userId });
        // Unique(user_id, job_id) — ignore duplicate-key from a race (another tab/click).
        if (error && !/duplicate key|unique/i.test(error.message)) throw error;
        toast.success("Saved to your list");
      } else {
        const { error } = await supabase.from("saved_jobs").delete().eq("job_id", jobId).eq("user_id", userId);
        if (error) throw error;
        toast.success("Removed from saved");
      }
    } catch (err) {
      setSaved(!next); // revert
      toast.error(err instanceof Error ? err.message : "Could not update saved jobs");
    } finally {
      setLoading(false);
    }
  };

  return { saved, toggle, loading, ready };
}
