import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthenticated, errorResult, textResult } from "../supabase";

export default defineTool({
  name: "my_saved_jobs",
  title: "My saved jobs",
  description: "List jobs the signed-in candidate has bookmarked on JobsKart.",
  inputSchema: { limit: z.number().optional().describe("Maximum rows to return (default 25, max 100).") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated();
    const take = Math.min(Math.max(limit ?? 25, 1), 100);
    const { data, error } = await supabaseForUser(ctx)
      .from("saved_jobs")
      .select("id, created_at, jobs(id, title, city, work_mode, job_type, min_salary, max_salary, status)")
      .eq("user_id", ctx.getUserId() as string)
      .order("created_at", { ascending: false })
      .limit(take);
    if (error) return errorResult(error.message);
    return textResult({ count: data?.length ?? 0, saved_jobs: data ?? [] });
  },
});
