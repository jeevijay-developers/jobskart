import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const TIER_VALUES = ["classic", "classic_plus", "trending"] as const;
export type JobTier = (typeof TIER_VALUES)[number];

// Stable error codes raised by activate_job_with_tier()
// (supabase/migrations/20260924100211_job_tiers_posting.sql), mapped to
// toast-friendly copy — same pattern as boost.functions.ts's mapBoostError.
const TIER_ERROR_MESSAGES: Record<string, string> = {
  insufficient_permissions: "You don't have permission to post for this company.",
  job_not_found: "This job could not be found.",
  job_not_draft: "This job has already been published.",
  live_jobs_max_reached: "You've reached your plan's live job limit. Close a job or upgrade to post more.",
  classic_plus_not_available: "Classic+ is only available on the Unlimited plan.",
  no_credits: "Not enough credits for this job tier. Buy more credits to continue.",
};

export function mapTierError(message: string): string {
  for (const [code, friendly] of Object.entries(TIER_ERROR_MESSAGES)) {
    if (message.includes(code)) return friendly;
  }
  return message;
}

export type ActivateJobResult = {
  job_id: string;
  tier: JobTier;
  tier_source: "plan" | "credits" | "admin_grant";
  balance_after: number;
};

// ---------------- activateJobWithTier ----------------
// Flips a draft job to active for the chosen tier. Must run with the
// caller's session (not the admin client): the RPC reads auth.uid()
// internally for its own membership + row-lock logic.
export const activateJobWithTier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ jobId: z.string().uuid(), tier: z.enum(TIER_VALUES) }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("activate_job_with_tier", {
      _job_id: data.jobId,
      _tier: data.tier,
    });
    if (error) throw new Error(error.message);
    return result as unknown as ActivateJobResult;
  });

// ---------------- getCompanyEntitlements ----------------
// One round trip for the tier picker: resolved plan limits, current usage,
// and credit prices, so the wizard can show quota-left and disable/price
// tiers before the employer commits to publishing.
export const getCompanyEntitlements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ companyId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("get_company_entitlements", {
      _company_id: data.companyId,
    });
    if (error) throw new Error(error.message);
    return result as unknown as {
      plan_id: string | null;
      plan_name: string;
      subscribed: boolean;
      limits: {
        live_jobs_max: number;
        classic_posts_per_month: number;
        classic_plus_enabled: boolean;
        trending_posts_per_month: number;
        repost_allowed: boolean;
        unlocks_per_job: number;
        response_retention_days: number;
      };
      tier_prices: { classic: number; classic_plus: number; trending: number };
      usage: {
        live_jobs: number;
        classic_posts_this_month: number;
        classic_plus_posts_this_month: number;
        trending_posts_this_month: number;
      };
    };
  });
