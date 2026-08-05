import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthenticated, errorResult, textResult } from "../supabase";

export default defineTool({
  name: "my_company_jobs",
  title: "My company's jobs",
  description:
    "List job postings belonging to the signed-in employer's company, including application counts and status.",
  inputSchema: {
    status: z.string().optional().describe("Filter by job status, e.g. active, paused, closed, draft."),
    limit: z.number().optional().describe("Maximum rows to return (default 25, max 100)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated();
    const supabase = supabaseForUser(ctx);
    const { data: members, error: memberError } = await supabase
      .from("employer_members")
      .select("company_id")
      .eq("user_id", ctx.getUserId() as string);
    if (memberError) return errorResult(memberError.message);
    const companyIds = (members ?? []).map((m) => m.company_id);
    if (companyIds.length === 0) {
      return errorResult("This account is not a member of any employer company on JobsKart.");
    }

    const take = Math.min(Math.max(limit ?? 25, 1), 100);
    let q = supabase
      .from("jobs")
      .select(
        "id, title, status, city, work_mode, job_type, openings, min_salary, max_salary, applications_count, views_count, created_at, expires_at, company_id",
      )
      .in("company_id", companyIds)
      .order("created_at", { ascending: false })
      .limit(take);
    if (status) q = q.eq("status", status as never);

    const { data, error } = await q;
    if (error) return errorResult(error.message);
    return textResult({ count: data?.length ?? 0, jobs: data ?? [] });
  },
});
