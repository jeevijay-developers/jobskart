import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { CandidateProfile, CandidateExperience, CandidateEducation, CandidateCertification, CandidateLanguage, CandidateLink, ResumeVersion } from "@/lib/resumeBuilder/types";
import { buildResumeSnapshot } from "@/lib/resumeBuilder/snapshot";
import { renderResumeToPdf } from "@/lib/resumeBuilder/pdfRenderer.server";
import { uploadResumePdf } from "@/lib/resumeBuilder/storage";

/**
 * Fetches the candidate profile + relations the same way the candidate
 * profile page (src/routes/_authenticated/candidate/profile.tsx) does:
 * separate per-table queries filtered by user_id, not a single PostgREST
 * embedded select. The previous embedded select
 * (`candidate_profiles.select("*, candidate_experiences(*), candidate_education(*),
 * candidate_certifications(*), candidate_languages(*), candidate_links(*)")`)
 * always failed — candidate_certifications and candidate_links were never
 * created as tables (see the commented-out `Database[...]` types in
 * resumeBuilder/types.ts), so PostgREST rejected the whole query with a
 * "relationship not found" error for every candidate, even ones with a
 * perfectly valid profile. That surfaced to the UI as "Unable to fetch
 * candidate profile" / "No profile data found".
 */
async function fetchCandidateProfileForResume(userId: string) {
  const [profileRes, expRes, eduRes, langRes] = await Promise.all([
    supabaseAdmin.from("candidate_profiles").select("*").eq("user_id", userId).maybeSingle(),
    supabaseAdmin
      .from("candidate_experiences")
      .select("*")
      .eq("user_id", userId)
      .order("start_date", { ascending: false }),
    supabaseAdmin
      .from("candidate_education")
      .select("*")
      .eq("user_id", userId)
      .order("year_of_passing", { ascending: false }),
    supabaseAdmin.from("candidate_languages").select("*").eq("user_id", userId),
  ]);

  if (profileRes.error || !profileRes.data) {
    return { profile: null, error: profileRes.error };
  }

  return {
    profile: {
      ...profileRes.data,
      experiences: expRes.data ?? [],
      educations: eduRes.data ?? [],
      // No candidate_certifications / candidate_links tables exist yet —
      // buildResumeSnapshot already treats these as optional and simply
      // omits the section when empty.
      certifications: [] as CandidateCertification[],
      languages: langRes.data ?? [],
      links: [] as CandidateLink[],
    },
    error: null,
  };
}

export const Route = createFileRoute("/api/resume-builder")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const authHeader = request.headers.get("authorization");
        let authUserId: string | null = null;
        if (authHeader && authHeader.startsWith("Bearer ")) {
          const token = authHeader.slice(7);
          const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
          if (!authError && user) authUserId = user.id;
        }
        const getUserId = (fallback?: string) => authUserId ?? fallback;
        const userId = getUserId(url.searchParams.get("userId") ?? undefined);
        if (!userId || typeof userId !== "string") {
          return new Response(JSON.stringify({ error: "Missing or invalid userId" }), { status: 400, headers: { "Content-Type": "application/json" } });
        }

        const { profile, error } = await fetchCandidateProfileForResume(userId);

        if (error || !profile) {
          console.error("Failed to fetch profile:", error);
          return new Response(JSON.stringify({ error: "Unable to fetch candidate profile" }), { status: 500, headers: { "Content-Type": "application/json" } });
        }

        const snapshot = buildResumeSnapshot(profile as CandidateProfile & {
          experiences?: CandidateExperience[];
          educations?: CandidateEducation[];
          certifications?: CandidateCertification[];
          languages?: CandidateLanguage[];
          links?: CandidateLink[];
        });
        return new Response(JSON.stringify(snapshot), { status: 200, headers: { "Content-Type": "application/json" } });
      },
POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization");
        let authUserId: string | null = null;
        if (authHeader && authHeader.startsWith("Bearer ")) {
          const token = authHeader.slice(7);
          const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
          if (!authError && user) authUserId = user.id;
        }
        const getUserId = (fallback?: string) => authUserId ?? fallback;

        let body: { userId?: string; templateId?: string } = {};
        try {
          body = await request.json();
        } catch {}
        const userId = getUserId(body.userId);
        const templateId = body.templateId;

        if (!userId || typeof userId !== "string") {
          return new Response(JSON.stringify({ error: "Missing or invalid userId" }), { status: 400, headers: { "Content-Type": "application/json" } });
        }

        const { profile, error: profileError } = await fetchCandidateProfileForResume(userId);

        if (profileError || !profile) {
          console.error("Failed to fetch profile for POST:", profileError);
          return new Response(JSON.stringify({ error: "Unable to fetch candidate profile" }), { status: 500, headers: { "Content-Type": "application/json" } });
        }

        const snapshot = buildResumeSnapshot(profile as CandidateProfile & {
          experiences?: CandidateExperience[];
          educations?: CandidateEducation[];
          certifications?: CandidateCertification[];
          languages?: CandidateLanguage[];
          links?: CandidateLink[];
        });
        const finalTemplateId = templateId ?? "classic-ats";

        const { data: versionData, error: versionError } = await supabaseAdmin
          .from("resume_versions")
          .select("version_number")
          .eq("user_id", userId)
          .order("version_number", { ascending: false })
          .limit(1);

        let nextVersion = 1;
        if (!versionError && versionData && versionData.length > 0) {
          nextVersion = (versionData[0].version_number ?? 0) + 1;
        }

        const { data: inserted, error: insertError } = await supabaseAdmin
          .from("resume_versions")
          .insert({
            user_id: userId,
            snapshot,
            template_id: finalTemplateId,
            version_number: nextVersion,
            created_at: new Date().toISOString(),
          })
          .select();

        if (insertError) {
          console.error("Failed to save resume version:", insertError);
          return new Response(JSON.stringify({ error: "Unable to save resume version" }), { status: 500, headers: { "Content-Type": "application/json" } });
        }

        let pdfUrl: string | null = null;
        try {
          const pdfBuffer = await renderResumeToPdf({
            ...snapshot,
            templateId: finalTemplateId,
          });
          pdfUrl = await uploadResumePdf(userId, nextVersion, pdfBuffer);
        } catch (pdfError) {
          console.error("PDF generation/upload failed:", pdfError);
        }

        const versionRecord = inserted[0] as ResumeVersion;
        return new Response(JSON.stringify({ version: versionRecord, pdfUrl }), { status: 201, headers: { "Content-Type": "application/json" } });
      },
    },
  },
});