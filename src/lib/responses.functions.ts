import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = z.string().uuid();

export type ResponseJobRow = {
  job_id: string;
  job_title: string;
  job_status: string;
  job_created_at: string;
  applicant_count: number;
};

// get_employer_response_jobs() — supabase/migrations/20261011140000_responses_grouped_by_job.sql.
// Not yet in generated types (new migration), so the RPC name/shape is cast
// at the call site rather than guessed into the Database type.
export const getResponseJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        companyId: uuid,
        status: z.string().nullish(),
        query: z.string().nullish(),
        includeClosed: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc(
      "get_employer_response_jobs" as never,
      {
        _company_id: data.companyId,
        _status: data.status ?? undefined,
        _query: data.query ?? undefined,
        _include_closed: data.includeClosed ?? false,
      } as never,
    );
    if (error) throw new Error(error.message);
    return (rows ?? []) as unknown as ResponseJobRow[];
  });

export type ResponseApplicantRow = {
  id: string;
  status: string;
  created_at: string;
  candidate_id: string;
  cover_note: string | null;
  expected_salary: number | null;
  available_from: string | null;
  job_title: string;
  full_name: string | null;
  email: string | null;
  city: string | null;
  avatar_url: string | null;
  mobile: string | null;
  total_count: number;
};

// get_employer_job_responses() — same migration as above.
export const getJobResponses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        companyId: uuid,
        jobId: uuid,
        status: z.string().nullish(),
        query: z.string().nullish(),
        limit: z.number().int().min(1).max(50).optional(),
        offset: z.number().int().min(0).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc(
      "get_employer_job_responses" as never,
      {
        _company_id: data.companyId,
        _job_id: data.jobId,
        _status: data.status ?? undefined,
        _query: data.query ?? undefined,
        _limit: data.limit ?? 10,
        _offset: data.offset ?? 0,
      } as never,
    );
    if (error) throw new Error(error.message);
    return (rows ?? []) as unknown as ResponseApplicantRow[];
  });

// get_employer_response_status_counts() — same migration as above. Backs
// the status chip bar: every status's count at once, scoped to the selected
// job (or all jobs) and the current search.
export const getResponseStatusCounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        companyId: uuid,
        jobId: uuid.nullish(),
        query: z.string().nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc(
      "get_employer_response_status_counts" as never,
      {
        _company_id: data.companyId,
        _job_id: data.jobId ?? undefined,
        _query: data.query ?? undefined,
      } as never,
    );
    if (error) throw new Error(error.message);
    const counts: Record<string, number> = { all: 0 };
    for (const row of (rows ?? []) as { status: string; n: number }[]) {
      counts[row.status] = row.n;
      counts.all += row.n;
    }
    return counts;
  });
