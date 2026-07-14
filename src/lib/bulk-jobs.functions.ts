import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const RowSchema = z.object({
  title: z.string().min(2),
  city: z.string().optional().default(""),
  job_type: z.string().default("full_time"),
  work_mode: z.string().default("on_site"),
  min_salary: z.number().nullable().optional(),
  max_salary: z.number().nullable().optional(),
  min_experience_years: z.number().nullable().optional(),
  max_experience_years: z.number().nullable().optional(),
  education: z.string().optional().default(""),
  skills: z.string().optional().default(""),
  description: z.string().optional().default(""),
  openings: z.number().int().positive().default(1),
});

const Input = z.object({
  company_id: z.string().uuid(),
  rows: z.array(RowSchema).min(1).max(200),
});

export const bulkCreateJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => Input.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: member } = await supabase
      .from("employer_members")
      .select("role")
      .eq("company_id", data.company_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!member) throw new Error("Not a member of this company");

    const payload = data.rows.map((r) => ({
      company_id: data.company_id,
      posted_by: userId,
      title: r.title,
      city: r.city || null,
      job_type: r.job_type,
      work_mode: r.work_mode,
      min_salary: r.min_salary ?? null,
      max_salary: r.max_salary ?? null,
      min_experience_years: r.min_experience_years ?? null,
      max_experience_years: r.max_experience_years ?? null,
      education: r.education || null,
      skills: r.skills ? r.skills.split(",").map((s) => s.trim()).filter(Boolean) : [],
      description: r.description || r.title,
      openings: r.openings,
      status: "published",
      salary_period: "monthly",
      pay_type: "fixed",
    }));

    const { data: inserted, error } = await supabase.from("jobs").insert(payload as never).select("id");
    if (error) throw new Error(error.message);
    return { count: inserted?.length ?? 0 };
  });
