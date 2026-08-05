import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseAnon, errorResult, textResult } from "../supabase";

const JOB_FIELDS =
  "id, title, city, state, work_mode, job_type, min_salary, max_salary, salary_period, min_experience_years, max_experience_years, skills, openings, created_at, slug, company_id, companies(name, logo_url, is_verified)";

export default defineTool({
  name: "search_jobs",
  title: "Search jobs",
  description:
    "Search live JobsKart job postings by keyword, city, work mode, job type, and minimum salary. Returns public listing data.",
  inputSchema: {
    query: z.string().optional().describe("Keyword matched against the job title."),
    city: z.string().optional().describe("City name, e.g. Jaipur."),
    work_mode: z.string().optional().describe("Work mode: on_site, hybrid, remote or field."),
    job_type: z.string().optional().describe("Employment type: full_time, part_time, internship or contract."),
    min_salary: z.number().optional().describe("Only jobs whose maximum salary is at least this amount."),
    limit: z.number().optional().describe("Maximum rows to return (default 20, max 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, city, work_mode, job_type, min_salary, limit }) => {
    const take = Math.min(Math.max(limit ?? 20, 1), 50);
    let q = supabaseAnon()
      .from("jobs")
      .select(JOB_FIELDS)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(take);

    if (query) q = q.ilike("title", `%${query}%`);
    if (city) q = q.ilike("city", `%${city}%`);
    if (work_mode) q = q.eq("work_mode", work_mode as never);
    if (job_type) q = q.eq("job_type", job_type as never);
    if (typeof min_salary === "number") q = q.gte("max_salary", min_salary);

    const { data, error } = await q;
    if (error) return errorResult(error.message);
    return textResult({ count: data?.length ?? 0, jobs: data ?? [] });
  },
});
