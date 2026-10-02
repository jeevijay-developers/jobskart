// Generates semantic-matching embeddings for jobs and candidate profiles,
// used by recommend_jobs_for_candidate()'s semantic_score component.
// Never blocks the caller's primary flow (job posting / profile save) —
// every handler swallows its own errors and reports { ok: false } instead
// of throwing, per the "no third-party failure blocks a core flow" rule.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { embed } from "@/lib/ai/provider";

export const embedCandidateProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    try {
      const [{ data: profile }, { data: cprof }] = await Promise.all([
        supabase.from("profiles").select("full_name, city").eq("id", userId).maybeSingle(),
        supabase
          .from("candidate_profiles")
          .select("headline, bio, skills, years_experience, last_role")
          .eq("user_id", userId)
          .maybeSingle(),
      ]);
      if (!cprof) return { ok: false as const };

      const text = [
        cprof.headline,
        profile?.full_name ? `Candidate: ${profile.full_name}` : null,
        cprof.last_role ? `Most recent role: ${cprof.last_role}` : null,
        cprof.years_experience != null ? `${cprof.years_experience} years of experience` : null,
        cprof.skills?.length ? `Skills: ${cprof.skills.join(", ")}` : null,
        profile?.city ? `Based in ${profile.city}` : null,
        cprof.bio,
      ]
        .filter(Boolean)
        .join(". ");
      if (!text.trim()) return { ok: false as const };

      const vector = await embed(text);
      const { error } = await supabase.rpc("update_candidate_profile_embedding", {
        _embedding: vector as never,
      });
      if (error) throw new Error(error.message);
      return { ok: true as const };
    } catch {
      return { ok: false as const };
    }
  });

const EmbedJobInput = z.object({ jobId: z.string().uuid() });

export const embedJobDescription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => EmbedJobInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    try {
      const { data: job } = await supabase
        .from("jobs")
        .select("title, description, skills, city, category")
        .eq("id", data.jobId)
        .maybeSingle();
      if (!job) return { ok: false as const };

      const text = [
        job.title,
        job.category ? `Category: ${job.category}` : null,
        job.skills?.length ? `Skills: ${job.skills.join(", ")}` : null,
        job.city ? `Location: ${job.city}` : null,
        job.description,
      ]
        .filter(Boolean)
        .join(". ");
      if (!text.trim()) return { ok: false as const };

      const vector = await embed(text);
      const { error } = await supabase.rpc("update_job_description_embedding", {
        _job_id: data.jobId,
        _embedding: vector as never,
      });
      if (error) throw new Error(error.message);
      return { ok: true as const };
    } catch {
      return { ok: false as const };
    }
  });
