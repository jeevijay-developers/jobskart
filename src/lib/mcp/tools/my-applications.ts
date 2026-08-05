import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthenticated, errorResult, textResult } from "../supabase";

export default defineTool({
  name: "my_applications",
  title: "My job applications",
  description: "List the signed-in candidate's job applications with their current status.",
  inputSchema: {
    status: z.string().optional().describe("Filter by application status, e.g. applied, shortlisted, rejected, hired."),
    limit: z.number().optional().describe("Maximum rows to return (default 25, max 100)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated();
    const take = Math.min(Math.max(limit ?? 25, 1), 100);
    let q = supabaseForUser(ctx)
      .from("applications")
      .select(
        "id, status, created_at, updated_at, expected_salary, cover_note, jobs(id, title, city, work_mode, job_type), companies(name)",
      )
      .eq("candidate_id", ctx.getUserId() as string)
      .order("created_at", { ascending: false })
      .limit(take);
    if (status) q = q.eq("status", status as never);

    const { data, error } = await q;
    if (error) return errorResult(error.message);
    return textResult({ count: data?.length ?? 0, applications: data ?? [] });
  },
});
