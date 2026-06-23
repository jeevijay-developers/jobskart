import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const searchJobTitles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { q: string }) =>
    z.object({ q: z.string().trim().min(3).max(60) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("job_titles_master")
      .select("id, title")
      .ilike("title", `%${data.q.replace(/[%_]/g, "")}%`)
      .eq("is_active", true)
      .order("title")
      .limit(20);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => r.title);
  });

export const addCustomJobTitle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { title: string }) =>
    z.object({ title: z.string().trim().min(2).max(80) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const title = data.title.replace(/\s+/g, " ").trim();
    const { error } = await context.supabase
      .from("job_titles_master")
      .upsert({ title, is_custom: true }, { onConflict: "title" });
    if (error) throw new Error(error.message);
    return { title };
  });

export const suggestSkills = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { roles: string[]; qualification?: string | null }) =>
    z
      .object({
        roles: z.array(z.string()).max(10).default([]),
        qualification: z.string().nullish(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const roleSkills: Record<string, string[]> = {
      sales: ["Sales", "Customer Service", "Negotiation", "MS Office", "Communication"],
      tele: ["Telecalling", "Customer Service", "CRM", "Hindi", "English"],
      delivery: ["Driving", "Bike Riding", "Navigation", "Customer Service", "Time Management"],
      driver: ["Driving", "Navigation", "Vehicle Maintenance"],
      cashier: ["Cash Handling", "POS", "Customer Service", "Accuracy"],
      data: ["Data Entry", "MS Excel", "Typing", "Attention to Detail"],
      account: ["Tally", "MS Excel", "GST", "Book Keeping"],
      it: ["Git", "JavaScript", "REST APIs", "SQL", "Problem Solving"],
      design: ["Figma", "Adobe Photoshop", "Typography", "Creativity"],
      hr: ["Recruitment", "MS Office", "Communication", "Employee Engagement"],
      market: ["SEO", "Social Media", "Content Writing", "Google Ads"],
    };
    const skills = new Set<string>();
    for (const r of data.roles) {
      const k = r.toLowerCase();
      for (const [key, arr] of Object.entries(roleSkills)) {
        if (k.includes(key)) arr.forEach((s) => skills.add(s));
      }
    }
    if (!skills.size) ["Communication", "MS Office", "Hindi", "English"].forEach((s) => skills.add(s));
    return Array.from(skills).slice(0, 12);
  });

export const upsertNudgeShown = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { kind: string }) =>
    z.object({ kind: z.enum(["profile_completion", "verification_awareness", "digilocker"]) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("candidate_nudges")
      .upsert(
        { user_id: context.userId, kind: data.kind, last_shown_at: new Date().toISOString() },
        { onConflict: "user_id,kind" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
