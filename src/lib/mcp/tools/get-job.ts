import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseAnon, errorResult, textResult } from "../supabase";

export default defineTool({
  name: "get_job",
  title: "Get job details",
  description: "Fetch the full public details of one JobsKart job posting by its id.",
  inputSchema: { job_id: z.string().describe("The job's UUID.") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ job_id }) => {
    const { data, error } = await supabaseAnon()
      .from("jobs")
      .select(
        "id, title, description, city, state, locality, work_mode, job_type, shift, min_salary, max_salary, salary_period, incentives_text, perks, skills, education, english_level, min_experience_years, max_experience_years, openings, interview_type, walkin, walkin_details, created_at, expires_at, status, companies(name, logo_url, about, website, industry, hq_city, is_verified)",
      )
      .eq("id", job_id)
      .maybeSingle();

    if (error) return errorResult(error.message);
    if (!data) return errorResult("No job found with that id (it may be closed or expired).");
    return textResult(data);
  },
});
