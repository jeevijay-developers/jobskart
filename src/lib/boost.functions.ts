import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertCompanyMember(supabase: any, userId: string, companyId: string) {
  const { data, error } = await supabase
    .from("employer_members")
    .select("user_id")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("You don't have access to this company.");
}

// Stable error codes raised by apply_boost() (supabase/migrations/20260924053114_job_boost_engine_ddl.sql),
// mapped to toast-friendly copy — same pattern as ScheduleInterviewModal's mapScheduleError.
const BOOST_ERROR_MESSAGES: Record<string, string> = {
  insufficient_permissions: "You don't have permission to boost jobs for this company.",
  job_not_found: "This job could not be found.",
  job_not_active: "Only active jobs can be boosted.",
  boost_disabled: "Boosting is temporarily unavailable — please try again later.",
  boost_same_day: "New jobs already get top visibility today — boost unlocks tomorrow.",
  boost_daily_cap: "Your company has reached today's boost limit.",
  no_credits: "Not enough credits to boost this job. Buy more credits to continue.",
};

export function mapBoostError(message: string): string {
  for (const [code, friendly] of Object.entries(BOOST_ERROR_MESSAGES)) {
    if (message.includes(code)) return friendly;
  }
  return message;
}

export type BoostResult = {
  boost_id: string;
  ends_at: string;
  credits_spent: number;
  balance_after: number;
};

// ---------------- applyBoost ----------------
export const applyBoost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ jobId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    // Calls apply_boost via the user-JWT client (not the admin client): the RPC
    // reads auth.uid() internally for its own permission + row-lock logic, so
    // it must run with the caller's session, not a service-role connection.
    const { data: result, error } = await context.supabase.rpc("apply_boost", {
      _job_id: data.jobId,
    });
    if (error) throw new Error(error.message);
    return result as unknown as BoostResult;
  });

// ---------------- getBoostOverview ----------------
// One round trip for the employer Jobs list: wallet balance, boost settings
// (cost/window/enabled so the UI can price and disable the button), and the
// active-boost end time per job for this company.
export const getBoostOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ companyId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertCompanyMember(context.supabase, context.userId, data.companyId);

    const [walletRes, settingsRes, boostsRes] = await Promise.all([
      context.supabase
        .from("employer_credit_wallets")
        .select("balance")
        .eq("company_id", data.companyId)
        .maybeSingle(),
      context.supabase.from("boost_settings").select("*").eq("id", 1).maybeSingle(),
      context.supabase
        .from("job_boosts")
        .select("job_id, ends_at")
        .eq("company_id", data.companyId)
        .gt("ends_at", new Date().toISOString()),
    ]);
    if (settingsRes.error) throw new Error(settingsRes.error.message);
    if (boostsRes.error) throw new Error(boostsRes.error.message);

    const activeBoostEndsAtByJobId: Record<string, string> = {};
    for (const row of boostsRes.data ?? []) {
      const current = activeBoostEndsAtByJobId[row.job_id as string];
      if (!current || (row.ends_at as string) > current) {
        activeBoostEndsAtByJobId[row.job_id as string] = row.ends_at as string;
      }
    }

    const settings = settingsRes.data;
    return {
      balance: walletRes.data?.balance ?? 0,
      settings: {
        costCredits: settings?.cost_credits ?? 1,
        windowHours: settings?.window_hours ?? 24,
        enabled: settings?.enabled ?? true,
      },
      activeBoostEndsAtByJobId,
    };
  });

// ---------------- getJobBoostHistory ----------------
export const getJobBoostHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ jobId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: job, error: jobErr } = await context.supabase
      .from("jobs")
      .select("company_id")
      .eq("id", data.jobId)
      .maybeSingle();
    if (jobErr) throw new Error(jobErr.message);
    if (!job) throw new Error("Job not found.");
    await assertCompanyMember(context.supabase, context.userId, job.company_id);

    const { data: rows, error } = await context.supabase
      .from("job_boosts")
      .select("id, starts_at, ends_at, credits_spent, created_at")
      .eq("job_id", data.jobId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
