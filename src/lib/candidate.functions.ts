import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { chatJSON } from "@/lib/ai/provider";

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
  .handler(async ({ data, context }) => {
    const roles = data.roles.map((r) => r.trim()).filter(Boolean);
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (name: string) => {
      const clean = name.replace(/\s+/g, " ").trim();
      if (!clean || clean.length > 40) return;
      const key = clean.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(clean);
    };

    // 1. Real usage: skills employers ask for on jobs matching these roles.
    if (roles.length) {
      const { data: ranked } = await context.supabase.rpc("suggest_skills_for_roles", {
        _roles: roles,
      });
      for (const row of (ranked ?? []) as { name: string }[]) push(row.name);
    }

    // 2. Top up from the approved master list.
    if (out.length < 12) {
      const { data: master } = await context.supabase
        .from("skills_master")
        .select("name")
        .eq("is_active", true)
        .eq("pending_review", false)
        .order("name")
        .limit(60);
      for (const row of master ?? []) {
        if (out.length >= 12) break;
        push(row.name);
      }
    }

    // 3. Still thin (new/niche role) → ask AI, then queue the new ones for admin review.
    if (out.length < 8 && roles.length) {
      try {
        const ai = await chatJSON(
          {
            system:
              "You suggest job skills for Indian job seekers. Reply with ONLY JSON: {\"skills\": string[]}. 10 short, concrete, widely-understood skill names. No sentences.",
            user: `Roles: ${roles.join(", ")}${data.qualification ? `\nQualification: ${data.qualification}` : ""}`,
            json: true,
          },
          z.object({ skills: z.array(z.string()).max(20) }),
        );
        const before = new Set(seen);
        for (const s of ai.skills) push(s);
        const fresh = out.filter((s) => !before.has(s.toLowerCase()));
        if (fresh.length) {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin.from("skills_master").upsert(
            fresh.map((name) => ({
              name,
              slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
              is_active: true,
              pending_review: true,
            })),
            { onConflict: "slug", ignoreDuplicates: true },
          );
        }
      } catch (e) {
        console.error("[skills] ai suggestion failed:", e);
      }
    }

    if (!out.length) ["Communication", "MS Office", "Hindi", "English"].forEach(push);
    return out.slice(0, 15);
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
