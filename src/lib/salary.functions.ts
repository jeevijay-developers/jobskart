import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

// Smart Salary Recommendation Engine (salary-recommendation-engine-implementation.md).
// The market logic lives in the get_salary_suggestion() Postgres function
// (migration 20260924140000) — this layer only validates input and degrades
// silently: any failure returns null so the job wizard NEVER breaks because
// of this feature (advisory-only rule).

export type SalarySuggestion = {
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  sample_count: number;
  source: "admin" | "computed";
  confidence: "high" | "medium";
  scope: string;
  title_key: string;
};

export const getSalarySuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        title: z.string().min(2),
        category: z.string().nullish(),
        city: z.string().min(1),
        experienceBucket: z.string().nullish(),
        payType: z.string().nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<SalarySuggestion | null> => {
    try {
      const { data: res, error } = await context.supabase.rpc("get_salary_suggestion", {
        _title: data.title,
        _category: data.category ?? undefined,
        _city: data.city,
        _experience_bucket: data.experienceBucket ?? "any",
        _pay_type: data.payType ?? "fixed",
      });
      if (error || !res) return null;
      return res as unknown as SalarySuggestion;
    } catch {
      return null;
    }
  });

// Adoption telemetry (plan Phase 4): shown/applied events land in
// employer_activity via the membership-checked log_salary_event() wrapper.
// Fire-and-forget — telemetry failures must never surface to the recruiter.
export const logSalarySuggestionEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        companyId: z.string().uuid(),
        kind: z.enum(["salary_suggestion_shown", "salary_suggestion_applied"]),
        meta: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    try {
      await context.supabase.rpc("log_salary_event", {
        _company_id: data.companyId,
        _kind: data.kind,
        _meta: (data.meta ?? {}) as Json,
      });
    } catch {
      /* telemetry is best-effort */
    }
    return null;
  });
