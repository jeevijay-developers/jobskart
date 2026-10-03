import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const EMPTY_IDS: ReadonlySet<string> = new Set();
const KEY = "applied-job-ids";

/**
 * The signed-in candidate's applied job ids, loaded once and shared by every
 * JobCard on screen. Lets a card show "Applied" from the database on load, not
 * only after a click in the same session.
 */
export function useAppliedJobIds(userId: string | null): ReadonlySet<string> {
  const { data } = useQuery({
    queryKey: [KEY, userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("job_id")
        .eq("candidate_id", userId!);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.job_id as string));
    },
  });
  return data ?? EMPTY_IDS;
}

/** Records a successful application so every card updates immediately. */
export function markJobApplied(queryClient: QueryClient, userId: string, jobId: string) {
  queryClient.setQueryData<Set<string>>([KEY, userId], (old) => new Set([...(old ?? []), jobId]));
}

export function useMarkJobApplied() {
  const queryClient = useQueryClient();
  return (userId: string, jobId: string) => markJobApplied(queryClient, userId, jobId);
}
