import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Stable error codes raised by renew_job() / set_job_auto_renew()
// (supabase/migrations/20260924120000_job_expiry_renewal.sql).
const EXPIRY_ERROR_MESSAGES: Record<string, string> = {
  insufficient_permissions: "You don't have permission to manage this job.",
  job_not_found: "This job could not be found.",
  job_not_renewable: "Only active or expired jobs can be renewed.",
  job_not_active: "Only active jobs can use auto-renew.",
  auto_renew_not_in_plan: "Auto-renew is a paid-plan feature — contact your admin to enable it.",
  auto_renew_limit_reached:
    "This job has used all its auto-renewals — renew it manually to keep it live.",
};

export function mapExpiryError(message: string): string {
  for (const [code, friendly] of Object.entries(EXPIRY_ERROR_MESSAGES)) {
    if (message.includes(code)) return friendly;
  }
  return message;
}

export const renewJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ jobId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("renew_job", {
      _job_id: data.jobId,
    });
    if (error) throw new Error(error.message);
    return result as unknown as { expires_at: string };
  });

export const setJobAutoRenew = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ jobId: z.string().uuid(), enabled: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("set_job_auto_renew", {
      _job_id: data.jobId,
      _enabled: data.enabled,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// One round trip for the employer Jobs list: per-job expiry state plus the
// company's auto-renew entitlement (plan limits override platform default).
export const getExpiryState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ companyId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const [jobsRes, entRes] = await Promise.all([
      context.supabase
        .from("jobs")
        .select("id, status, expires_at, auto_renew, renewed_count")
        .eq("company_id", data.companyId)
        .in("status", ["active", "expired"]),
      context.supabase.rpc("company_auto_renew", { _company_id: data.companyId }),
    ]);
    if (jobsRes.error) throw new Error(jobsRes.error.message);
    if (entRes.error) throw new Error(entRes.error.message);

    const ent = (entRes.data as { enabled: boolean; max_times: number }[] | null)?.[0];
    return {
      jobs: (jobsRes.data ?? []) as {
        id: string;
        status: string;
        expires_at: string | null;
        auto_renew: boolean;
        renewed_count: number;
      }[],
      entitlement: { enabled: ent?.enabled ?? false, maxTimes: ent?.max_times ?? 3 },
    };
  });
