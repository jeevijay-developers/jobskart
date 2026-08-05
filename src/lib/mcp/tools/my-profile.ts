import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser, notAuthenticated, errorResult, textResult } from "../supabase";

export default defineTool({
  name: "my_profile",
  title: "My JobsKart profile",
  description:
    "Return the signed-in user's JobsKart account profile, plus candidate profile details or employer company memberships.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated();
    const supabase = supabaseForUser(ctx);
    const userId = ctx.getUserId();

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id, full_name, email, mobile, city, user_type, status, created_at")
      .eq("id", userId as string)
      .maybeSingle();
    if (error) return errorResult(error.message);
    if (!profile) return errorResult("No JobsKart profile is linked to this account yet.");

    if (profile.user_type === "candidate") {
      const { data: candidate } = await supabase
        .from("candidate_profiles")
        .select(
          "headline, bio, skills, interested_roles, preferred_cities, preferred_job_types, preferred_work_mode, years_experience, experience_status, current_salary, expected_salary, notice_period_days, highest_qualification, profile_strength, onboarding_completed, kyc_status, resume_name",
        )
        .eq("user_id", userId as string)
        .maybeSingle();
      return textResult({ profile, candidate_profile: candidate ?? null });
    }

    const { data: companies } = await supabase
      .from("employer_members")
      .select("role, company_id, companies(name, slug, industry, hq_city, verification_status, onboarding_completed)")
      .eq("user_id", userId as string);
    return textResult({ profile, companies: companies ?? [] });
  },
});
