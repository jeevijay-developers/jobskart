import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { chatJSON } from "@/lib/ai/provider";
import { assertNoProtectedFields } from "@/lib/ai-shortlist-guard";


const input = z.object({
  jobId: z.string().uuid(),
  refresh: z.boolean().optional().default(false),
});

const AiScoreResponse = z.object({
  results: z
    .array(
      z.object({
        application_id: z.string(),
        score: z.number(),
        reasons: z.array(z.string()).default([]),
        summary: z.string().optional(),
      }),
    )
    .default([]),
});

type ScoreRow = {
  application_id: string;
  candidate_id: string;
  score: number;
  reasons: string[];
  summary: string | null;
  full_name: string | null;
  city: string | null;
  avatar_url: string | null;
  status: string;
  created_at: string;
};

const CACHE_HOURS = 1;

export const recommendShortlist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => input.parse(d))
  .handler(async ({ data, context }): Promise<ScoreRow[]> => {
    const { supabase, userId } = context;
    const { jobId, refresh } = data;

    const { data: job } = await supabase
      .from("jobs")
      // Never add age_min/age_max/gender_pref here — see assertNoProtectedFields below.
      .select("id, company_id, title, description, skills, min_experience_years, city")
      .eq("id", jobId)
      .maybeSingle();
    if (!job) throw new Error("Job not found");
    assertNoProtectedFields(job);

    const { data: membership } = await supabase
      .from("employer_members")
      .select("user_id")
      .eq("company_id", job.company_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!membership) throw new Error("Forbidden");

    const { data: apps } = await supabase
      .from("applications")
      .select(
        "id, candidate_id, status, created_at, cover_note, expected_salary, available_from, profiles!candidate_id (full_name, city, avatar_url)",
      )
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (!apps?.length) return [];

    const appIds = apps.map((a) => a.id);
    const { data: cached } = await supabase
      .from("application_ai_scores")
      .select("application_id, candidate_id, score, reasons, summary, computed_at")
      .eq("job_id", jobId)
      .in("application_id", appIds);

    const cutoff = Date.now() - CACHE_HOURS * 3600 * 1000;
    const cachedMap = new Map(
      (cached || [])
        .filter((c) => !refresh && new Date(c.computed_at).getTime() > cutoff)
        .map((c) => [c.application_id, c]),
    );

    const needScoring = apps.filter((a) => !cachedMap.has(a.id));

    if (needScoring.length) {
      const candidateIds = needScoring.map((a) => a.candidate_id);
      const { data: profilesData } = await supabase
        .from("candidate_profiles")
        .select("user_id, headline, skills, years_experience, last_role, bio")
        .in("user_id", candidateIds);
      const profileMap = new Map((profilesData || []).map((p) => [p.user_id, p]));

      const items = needScoring.map((a) => {
        const p = profileMap.get(a.candidate_id);
        const app = a as unknown as {
          cover_note: string | null;
          expected_salary: number | null;
          available_from: string | null;
        };
        return {
          application_id: a.id,
          candidate_id: a.candidate_id,
          headline: p?.headline ?? null,
          last_role: p?.last_role ?? null,
          years_experience: p?.years_experience ?? null,
          skills: p?.skills ?? [],
          bio: (p?.bio ?? "").slice(0, 300),
          cover_note: (app.cover_note ?? "").slice(0, 400),
          expected_salary: app.expected_salary ?? null,
          available_from: app.available_from ?? null,
        };
      });

      const prompt = `Score each candidate 0-100 against this job. Return strict JSON only:
{"results":[{"application_id":"...","score":85,"reasons":["..."],"summary":"one line"}]}

JOB
Title: ${job.title}
Skills required: ${(job.skills || []).join(", ") || "n/a"}
Min experience: ${job.min_experience_years ?? 0} years
City: ${job.city ?? "any"}
Description: ${(job.description || "").slice(0, 800)}

CANDIDATES
${JSON.stringify(items)}

Each candidate also includes cover_note, expected_salary and available_from from their
application form. Use these only as supporting context in your reasons/summary (e.g. flag
a mismatched expected salary or a relevant point from their cover note) — they are NOT
part of the numeric formula below.

Scoring: skill overlap 50%, experience fit 25%, role/title relevance 15%, location 10%.
Give 2-4 short bullet reasons each. Be honest — low scores when off-target.`;

      const parsed = await chatJSON(
        {
          system: "You rank job candidates. Output only valid JSON.",
          user: prompt,
        },
        AiScoreResponse,
      );

      const upserts = parsed.results
        .filter((r) => r.application_id && needScoring.find((a) => a.id === r.application_id))
        .map((r) => {
          const app = needScoring.find((a) => a.id === r.application_id)!;
          return {
            job_id: jobId,
            application_id: r.application_id,
            candidate_id: app.candidate_id,
            score: Math.max(0, Math.min(100, Math.round(r.score || 0))),
            reasons: r.reasons.slice(0, 5),
            summary: r.summary?.slice(0, 200) || null,
            computed_at: new Date().toISOString(),
          };
        });

      if (upserts.length) {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin.from("application_ai_scores").upsert(upserts, { onConflict: "job_id,application_id" });
        upserts.forEach((u) => cachedMap.set(u.application_id, { ...u, computed_at: u.computed_at }));
      }
    }

    const rows: ScoreRow[] = apps
      .map((a) => {
        const c = cachedMap.get(a.id);
        const p = (a as unknown as { profiles: { full_name: string | null; city: string | null; avatar_url: string | null } | null }).profiles;
        return {
          application_id: a.id,
          candidate_id: a.candidate_id,
          score: c?.score ?? 0,
          reasons: (c?.reasons as string[]) ?? [],
          summary: (c?.summary as string | null) ?? null,
          full_name: p?.full_name ?? null,
          city: p?.city ?? null,
          avatar_url: p?.avatar_url ?? null,
          status: a.status as string,
          created_at: a.created_at as string,
        };
      })
      .sort((a, b) => b.score - a.score);
    return rows;
  });
