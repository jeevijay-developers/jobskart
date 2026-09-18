import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatSalary } from "@/lib/format";

type ShareableJob = {
  id: string;
  title: string;
  min_salary?: number | null;
  max_salary?: number | null;
  salary_period?: string | null;
  companies?: { name: string } | null;
};

/**
 * Same share flow as the job detail page (Web Share API with a
 * clipboard-copy fallback), plus a best-effort row in job_shares so a
 * candidate's share action is tracked. Tracking never blocks or fails the
 * actual share/copy.
 */
export function useShareJob() {
  const share = async (job: ShareableJob, userId: string | null) => {
    const url = typeof window !== "undefined" ? `${window.location.origin}/jobs/${job.id}` : "";
    const text = `${job.title} at ${job.companies?.name || "a top company"} · ${formatSalary(job.min_salary, job.max_salary, job.salary_period || "monthly")}`;

    const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
    let shared = false;
    if (canNativeShare) {
      try {
        await navigator.share({ title: job.title, text, url });
        shared = true;
      } catch {
        /* user cancelled — not an error, and not a completed share */
      }
    } else {
      try {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied to clipboard");
        shared = true;
      } catch {
        toast.error("Could not copy link");
      }
    }

    if (shared) {
      // job_shares is a fresh table (supabase/migrations/20260918062140_add_job_shares.sql)
      // not yet in the generated Supabase types — cast until `supabase gen types` picks it up.
      (supabase as unknown as { from: (relation: string) => { insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }> } })
        .from("job_shares")
        .insert({ job_id: job.id, user_id: userId, channel: canNativeShare ? "native" : "clipboard" })
        .then((res: { error: { message: string } | null }) => {
          if (res.error) console.error("[job_shares] insert failed:", res.error.message);
        });
    }
  };

  return { share };
}
