// Excel download server functions with per-user daily cap (300 rows/day)
// enforced by the register_download() RPC.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const KindSchema = z.enum(["responses", "unlocked_profiles"]);

export const buildDownloadDataset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      companyId: z.string().uuid(),
      kind: KindSchema,
      jobId: z.string().uuid().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Membership check
    const { data: mem } = await supabase
      .from("employer_members").select("user_id")
      .eq("company_id", data.companyId).eq("user_id", userId).maybeSingle();
    if (!mem) throw new Error("You don't have access to this company.");

    let rows: Record<string, unknown>[] = [];
    if (data.kind === "responses") {
      let q = supabase
        .from("applications")
        .select("id, status, created_at, jobs!inner(id, title, company_id, responses_locked_after), profiles!applications_candidate_id_fkey(full_name, email, mobile, city)")
        .eq("jobs.company_id", data.companyId)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (data.jobId) q = q.eq("job_id", data.jobId);
      const { data: apps, error } = await q;
      if (error) throw new Error(error.message);
      rows = (apps ?? [])
        // exclude apps for jobs whose responses window has expired
        .filter((a) => {
          const j = a.jobs as { responses_locked_after: string | null } | null;
          return !j?.responses_locked_after || new Date(j.responses_locked_after) > new Date();
        })
        .map((a) => {
          const j = a.jobs as { title: string | null } | null;
          const p = a.profiles as { full_name: string | null; email: string | null; mobile: string | null; city: string | null } | null;
          return {
            Name: p?.full_name ?? "",
            Mobile: p?.mobile ?? "",
            Email: p?.email ?? "",
            City: p?.city ?? "",
            Job: j?.title ?? "",
            Status: a.status,
            AppliedOn: new Date(a.created_at as string).toISOString(),
          };
        });
    } else {
      const { data: unlocks, error } = await supabase
        .from("candidate_unlocks")
        .select("candidate_user_id, credits_spent, created_at, profiles!candidate_unlocks_candidate_user_id_fkey(full_name, email, mobile, city)")
        .eq("company_id", data.companyId)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw new Error(error.message);
      rows = (unlocks ?? []).map((u) => {
        const p = u.profiles as { full_name: string | null; email: string | null; mobile: string | null; city: string | null } | null;
        return {
          Name: p?.full_name ?? "",
          Mobile: p?.mobile ?? "",
          Email: p?.email ?? "",
          City: p?.city ?? "",
          CreditsSpent: u.credits_spent,
          UnlockedOn: new Date(u.created_at as string).toISOString(),
        };
      });
    }

    if (rows.length === 0) throw new Error("Nothing to download yet.");

    // Enforce 300/day cap
    const { data: newCount, error: capErr } = await supabase.rpc("register_download", {
      _company_id: data.companyId,
      _kind: data.kind,
      _count: rows.length,
    });
    if (capErr) throw new Error(capErr.message);
    return { rows, todayCount: newCount as number };
  });
