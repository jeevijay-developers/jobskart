import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthenticated, errorResult, textResult } from "../supabase";

export default defineTool({
  name: "job_applicants",
  title: "Applicants for a job",
  description:
    "List applicants for one of the signed-in employer's job postings. Access is enforced by company membership.",
  inputSchema: {
    job_id: z.string().describe("The job's UUID (from my_company_jobs)."),
    status: z.string().optional().describe("Filter by application status, e.g. applied, shortlisted, rejected, hired."),
    limit: z.number().optional().describe("Maximum rows to return (default 25, max 100)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ job_id, status, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated();
    const take = Math.min(Math.max(limit ?? 25, 1), 100);
    let q = supabaseForUser(ctx)
      .from("applications")
      .select(
        "id, status, created_at, expected_salary, available_from, cover_note, employer_notes, candidate_id, profiles:candidate_id(full_name, city)",
      )
      .eq("job_id", job_id)
      .order("created_at", { ascending: false })
      .limit(take);
    if (status) q = q.eq("status", status as never);

    const { data, error } = await q;
    if (error) return errorResult(error.message);
    if (!data || data.length === 0) {
      return textResult({ count: 0, applicants: [], note: "No applicants visible for this job on this account." });
    }
    return textResult({ count: data.length, applicants: data });
  },
});
