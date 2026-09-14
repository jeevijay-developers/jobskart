import { supabase } from "@/integrations/supabase/client";

export type ResumeFile = { path: string; name: string };
export type CandidateResume = ResumeFile | null;

/** The candidate's resume on file — sourced from their profile, falling back to their latest uploaded resume document. */
export async function getCandidateResume(userId: string): Promise<CandidateResume> {
  const [{ data: cp }, { data: docs }] = await Promise.all([
    supabase.from("candidate_profiles").select("resume_url").eq("user_id", userId).maybeSingle(),
    supabase
      .from("candidate_documents")
      .select("file_path, file_name")
      .eq("user_id", userId)
      .eq("doc_type", "resume")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);
  const path = cp?.resume_url || docs?.[0]?.file_path || null;
  if (!path) return null;
  const name = docs?.[0]?.file_name || path.split("/").pop() || "Resume";
  return { path, name };
}
