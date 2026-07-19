// Excel download server functions with per-user daily cap (300 rows/day)
// enforced by the register_download() RPC.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const KindSchema = z.enum(["responses", "unlocked_profiles"]);

export type DownloadRow = {
  Name: string; Mobile: string; Email: string; City: string;
  Job?: string; Status?: string; AppliedOn?: string;
  CreditsSpent?: number; UnlockedOn?: string;
};

type ProfileJoin = { full_name: string | null; email: string | null; mobile: string | null; city: string | null } | null;

export const buildDownloadDataset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      companyId: z.string().uuid(),
      kind: KindSchema,
      jobId: z.string().uuid().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ rows: DownloadRow[]; todayCount: number }> => {
    const { supabase, userId } = context;

    const { data: mem } = await supabase
      .from("employer_members").select("user_id")
      .eq("company_id", data.companyId).eq("user_id", userId).maybeSingle();
    if (!mem) throw new Error("You don't have access to this company.");

    let rows: DownloadRow[] = [];
    if (data.kind === "responses") {
      let q = supabase
        .from("applications")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .select("id, status, created_at, jobs!inner(id, title, company_id, responses_locked_after), profiles:candidate_id(full_name, email, mobile, city)" as any)
        .eq("jobs.company_id", data.companyId)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (data.jobId) q = q.eq("job_id", data.jobId);
      const { data: apps, error } = await q;
      if (error) throw new Error(error.message);
      rows = ((apps ?? []) as unknown as Array<{ status: string; created_at: string; jobs: { title: string | null; responses_locked_after: string | null } | null; profiles: ProfileJoin }>)
        .filter((a) => !a.jobs?.responses_locked_after || new Date(a.jobs.responses_locked_after) > new Date())
        .map((a) => ({
          Name: a.profiles?.full_name ?? "",
          Mobile: a.profiles?.mobile ?? "",
          Email: a.profiles?.email ?? "",
          City: a.profiles?.city ?? "",
          Job: a.jobs?.title ?? "",
          Status: a.status,
          AppliedOn: new Date(a.created_at).toISOString(),
        }));
    } else {
      const { data: unlocks, error } = await supabase
        .from("candidate_unlocks")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .select("candidate_user_id, credits_spent, created_at, profiles:candidate_user_id(full_name, email, mobile, city)" as any)
        .eq("company_id", data.companyId)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw new Error(error.message);
      rows = ((unlocks ?? []) as unknown as Array<{ credits_spent: number; created_at: string; profiles: ProfileJoin }>)
        .map((u) => ({
          Name: u.profiles?.full_name ?? "",
          Mobile: u.profiles?.mobile ?? "",
          Email: u.profiles?.email ?? "",
          City: u.profiles?.city ?? "",
          CreditsSpent: u.credits_spent,
          UnlockedOn: new Date(u.created_at).toISOString(),
        }));
    }

    if (rows.length === 0) throw new Error("Nothing to download yet.");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: newCount, error: capErr } = await supabase.rpc("register_download" as any, {
      _company_id: data.companyId,
      _kind: data.kind,
      _count: rows.length,
    });
    if (capErr) throw new Error(capErr.message);
    return { rows, todayCount: (newCount as number) ?? rows.length };
  });
