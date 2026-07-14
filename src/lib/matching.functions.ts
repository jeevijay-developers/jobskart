// AI-scored applicant ranking. Uses Lovable AI (Gemini 2.0 Flash).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({ job_id: z.string().uuid() });

type CandRow = {
  application_id: string;
  candidate_id: string;
  full_name: string | null;
  skills: string[] | null;
  years_experience: number | null;
  headline: string | null;
  city: string | null;
};

export const scoreJobApplicants = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => Input.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: job } = await supabase
      .from("jobs")
      .select("id, company_id, title, skills, min_experience_years, max_experience_years, city, description, auto_shortlist_threshold")
      .eq("id", data.job_id)
      .maybeSingle();
    if (!job) throw new Error("Job not found");

    const { data: apps } = await supabase
      .from("applications")
      .select("id, candidate_id")
      .eq("job_id", data.job_id);
    const ids = (apps || []).map((a) => a.candidate_id);
    if (!ids.length) return { scored: 0, shortlisted: 0 };

    const [{ data: profiles }, { data: cprofs }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, city").in("id", ids),
      supabase.from("candidate_profiles").select("user_id, skills, years_experience, headline").in("user_id", ids),
    ]);
    const pMap = Object.fromEntries((profiles || []).map((p) => [p.id, p]));
    const cMap = Object.fromEntries((cprofs || []).map((c) => [c.user_id, c]));

    const rows: CandRow[] = (apps || []).map((a) => {
      const p = pMap[a.candidate_id];
      const c = cMap[a.candidate_id];
      return {
        application_id: a.id,
        candidate_id: a.candidate_id,
        full_name: p?.full_name ?? null,
        skills: c?.skills ?? null,
        years_experience: c?.years_experience ?? null,
        headline: c?.headline ?? null,
        city: p?.city ?? null,
      };
    });

    const apiKey = process.env.LOVABLE_API_KEY;
    let scores: Array<{ application_id: string; score: number; reason: string }> = [];

    if (apiKey && rows.length) {
      const prompt = `You are a hiring assistant. Score each candidate 0-100 for fit to the role.
Job: ${job.title}
Required skills: ${(job.skills || []).join(", ")}
Experience: ${job.min_experience_years ?? 0}-${job.max_experience_years ?? "any"} years
Location: ${job.city || "any"}

Return ONLY valid JSON: {"scores":[{"application_id":"...","score":0-100,"reason":"one short line"}]}

Candidates:
${rows.map((r, i) => `${i + 1}. app_id=${r.application_id} name="${r.full_name}" skills="${(r.skills || []).join(", ")}" yrs=${r.years_experience ?? 0} city="${r.city}" headline="${r.headline}"`).join("\n")}`;

      try {
        const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
          }),
        });
        if (res.ok) {
          const j = await res.json();
          const parsed = JSON.parse(j.choices?.[0]?.message?.content || "{}");
          scores = Array.isArray(parsed.scores) ? parsed.scores : [];
        }
      } catch { /* fall through to heuristic */ }
    }

    if (!scores.length) {
      // Heuristic fallback
      const jSkills = (job.skills || []).map((s) => s.toLowerCase());
      scores = rows.map((r) => {
        const cs = (r.skills || []).map((s) => s.toLowerCase());
        const overlap = jSkills.length ? jSkills.filter((s) => cs.includes(s)).length / jSkills.length : 0.4;
        const s = Math.min(100, Math.round(overlap * 70 + Math.min((r.years_experience ?? 0) * 5, 20) + 10));
        return { application_id: r.application_id, score: s, reason: `${Math.round(overlap * 100)}% skill match, ${r.years_experience ?? 0} yr exp` };
      });
    }

    // Persist
    const rowById = Object.fromEntries(rows.map((r) => [r.application_id, r]));
    const upserts = scores.map((s) => {
      const r = rowById[s.application_id];
      return {
        application_id: s.application_id,
        job_id: data.job_id,
        company_id: job.company_id,
        candidate_id: r?.candidate_id,
        score: s.score,
        summary: s.reason,
        status: "scored",
      };
    });
    if (upserts.length) {
      await supabase.from("application_match_scores").upsert(upserts as never, { onConflict: "application_id" });
    }

    // Auto-shortlist
    const threshold = job.auto_shortlist_threshold ?? 0;
    let shortlisted = 0;
    if (threshold > 0) {
      const toShortlist = scores.filter((s) => s.score >= threshold).map((s) => s.application_id);
      if (toShortlist.length) {
        await supabase.from("applications").update({ status: "shortlisted" } as never).in("id", toShortlist).eq("status", "applied");
        shortlisted = toShortlist.length;
      }
    }
    return { scored: scores.length, shortlisted };
  });
