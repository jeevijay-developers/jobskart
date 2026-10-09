import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import type { CandidateProfile, CandidateExperience, CandidateEducation, CandidateCertification, CandidateLanguage, CandidateLink, ResumeVersion } from "@/lib/resumeBuilder/types";
import { buildResumeSnapshot, applyResumeExtras } from "@/lib/resumeBuilder/snapshot";
import type { ResumeExtras } from "@/lib/resumeBuilder/schema";
import { getTemplateTheme, normalizeLayout } from "@/lib/resumeBuilder/templates/theme";
import { renderResumeToPdf } from "@/lib/resumeBuilder/renderResumePdf.server";
import { uploadResumePdf } from "@/lib/resumeBuilder/storage";
import { MAX_RESUME_VERSIONS, RESUME_VERSION_LIMIT_MESSAGE } from "@/lib/resumeBuilder/limits";

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
  const [identityRes, profileRes, expRes, eduRes, langRes] = await Promise.all([
    // full_name/mobile/email/city live on `profiles`, not `candidate_profiles`.
    supabaseAdmin.from("profiles").select("full_name, mobile, email, city").eq("id", userId).maybeSingle(),
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
    return { profile: null, identity: null, error: profileRes.error };
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
    identity: {
      fullName: identityRes.data?.full_name ?? "",
      mobile: identityRes.data?.mobile ?? null,
      email: identityRes.data?.email ?? null,
      city: identityRes.data?.city ?? null,
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

        const { profile, identity, error } = await fetchCandidateProfileForResume(userId);

        if (error || !profile || !identity) {
          console.error("Failed to fetch profile:", error);
          return new Response(JSON.stringify({ error: "Unable to fetch candidate profile" }), { status: 500, headers: { "Content-Type": "application/json" } });
        }

        const snapshot = buildResumeSnapshot(profile as CandidateProfile & {
          experiences?: CandidateExperience[];
          educations?: CandidateEducation[];
          certifications?: CandidateCertification[];
          languages?: CandidateLanguage[];
          links?: CandidateLink[];
        }, identity);
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

        let body: { userId?: string; templateId?: string; layout?: unknown; versionNumber?: number } = {};
        try {
          body = await request.json();
        } catch {}
        const userId = getUserId(body.userId);
        const templateId = body.templateId;

        if (!userId || typeof userId !== "string") {
          return new Response(JSON.stringify({ error: "Missing or invalid userId" }), { status: 400, headers: { "Content-Type": "application/json" } });
        }

        const { profile, identity, error: profileError } = await fetchCandidateProfileForResume(userId);

        if (profileError || !profile || !identity) {
          console.error("Failed to fetch profile for POST:", profileError);
          return new Response(JSON.stringify({ error: "Unable to fetch candidate profile" }), { status: 500, headers: { "Content-Type": "application/json" } });
        }

        const snapshot = buildResumeSnapshot(profile as CandidateProfile & {
          experiences?: CandidateExperience[];
          educations?: CandidateEducation[];
          certifications?: CandidateCertification[];
          languages?: CandidateLanguage[];
          links?: CandidateLink[];
        }, identity);
        const finalTemplateId = templateId ?? "classic-ats";

        // Candidate-authored extras (hobbies, certifications, rich-text
        // overrides…) live in resume_drafts and are merged here so the saved
        // version and its PDF include exactly what the live preview showed.
        const { data: draftRow } = await supabaseAdmin
          .from("resume_drafts")
          .select("extras")
          .eq("user_id", userId)
          .maybeSingle();
        const withExtras = applyResumeExtras(snapshot, (draftRow?.extras ?? {}) as ResumeExtras);

        // buildResumeSnapshot() always sets templateId internally to the
        // default — overwrite it with the actually-selected template before
        // persisting, so a re-preview of this saved version later renders
        // with the template the candidate picked, not always Classic ATS.
        // Layout settings come from the client but are re-validated/clamped here
        // (normalizeLayout) so a version can never persist out-of-range values.
        const layout = body.layout ? normalizeLayout(body.layout, getTemplateTheme(finalTemplateId)) : undefined;
        const finalSnapshot = { ...withExtras, templateId: finalTemplateId, layout };

        const json = (status: number, payload: Record<string, unknown>) =>
          new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });

        let nextVersion: number;
        let versionRecord: ResumeVersion;
        const editing = typeof body.versionNumber === "number" && Number.isInteger(body.versionNumber);

        if (editing) {
          // Editing an existing version updates that same row (and its PDF) — it never adds a version
          // and never takes another slot. Ownership: filtered by the authenticated user id.
          nextVersion = body.versionNumber as number;
          const { data: updated, error: updateError } = await supabaseAdmin
            .from("resume_versions")
            .update({ snapshot: finalSnapshot as unknown as Json, template_id: finalTemplateId })
            .eq("user_id", userId)
            .eq("version_number", nextVersion)
            .select();
          if (updateError) {
            console.error("Failed to update resume version:", updateError);
            return json(500, { error: "Unable to update resume version" });
          }
          if (!updated || updated.length === 0) return json(404, { error: "Resume version not found" });
          versionRecord = updated[0] as ResumeVersion;
        } else {
          // Lifetime limit, checked up front for a clear message; the database trigger is the real
          // guard. Deleting a version doesn't give a generation back: use the lifetime counter, or
          // (before it exists / has a row) the best historical record - versions held or the highest
          // version number ever issued.
          let used: number | null = null;
          const counter = await supabaseAdmin
            .from("resume_generation_counts" as never)
            .select("total")
            .eq("user_id", userId)
            .maybeSingle();
          if (!counter.error && counter.data) used = (counter.data as unknown as { total: number }).total;
          if (used === null) {
            const { data: held } = await supabaseAdmin
              .from("resume_versions")
              .select("version_number")
              .eq("user_id", userId);
            used = Math.max(held?.length ?? 0, ...(held ?? []).map((v) => v.version_number ?? 0));
          }
          if (used >= MAX_RESUME_VERSIONS) {
            return json(409, { error: RESUME_VERSION_LIMIT_MESSAGE, code: "version_limit" });
          }

          const { data: versionData, error: versionError } = await supabaseAdmin
            .from("resume_versions")
            .select("version_number")
            .eq("user_id", userId)
            .order("version_number", { ascending: false })
            .limit(1);

          nextVersion = 1;
          if (!versionError && versionData && versionData.length > 0) {
            nextVersion = (versionData[0].version_number ?? 0) + 1;
          }

          const { data: inserted, error: insertError } = await supabaseAdmin
            .from("resume_versions")
            .insert({
              user_id: userId,
              snapshot: finalSnapshot as unknown as Json,
              template_id: finalTemplateId,
              version_number: nextVersion,
              created_at: new Date().toISOString(),
            })
            .select();

          if (insertError) {
            if (insertError.message?.includes("resume_generation_limit")) {
              return json(409, { error: RESUME_VERSION_LIMIT_MESSAGE, code: "version_limit" });
            }
            console.error("Failed to save resume version:", insertError);
            return json(500, { error: "Unable to save resume version" });
          }
          versionRecord = inserted[0] as ResumeVersion;
        }

        let pdfUrl: string | null = null;
        try {
          const pdfBuffer = await renderResumeToPdf(finalSnapshot);
          pdfUrl = await uploadResumePdf(userId, nextVersion, pdfBuffer);
        } catch (pdfError) {
          console.error("PDF generation/upload failed:", pdfError);
        }

        return new Response(JSON.stringify({ version: versionRecord, pdfUrl }), {
          status: editing ? 200 : 201,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});