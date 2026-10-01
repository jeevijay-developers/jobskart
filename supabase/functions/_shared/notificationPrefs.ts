import type { createAdminClient } from "./supabaseAdmin.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

type CandidateEmailPrefs = { email_alerts: boolean; weekly_digest: boolean };

const DEFAULT_PREFS: CandidateEmailPrefs = { email_alerts: true, weekly_digest: true };

/**
 * Reads candidate_profiles.notification_prefs for one candidate. Missing row/key
 * defaults to opted-in (true), matching the client-side default in
 * src/routes/_authenticated/candidate/settings.tsx — a candidate who never
 * opened Settings has implicitly agreed to the default, not silently opted out.
 */
export async function getCandidateEmailPrefs(
  admin: AdminClient,
  userId: string,
): Promise<CandidateEmailPrefs> {
  const { data } = await admin
    .from("candidate_profiles")
    .select("notification_prefs")
    .eq("user_id", userId)
    .maybeSingle();
  const prefs = (data as { notification_prefs?: Partial<CandidateEmailPrefs> } | null)
    ?.notification_prefs;
  return { ...DEFAULT_PREFS, ...prefs };
}
