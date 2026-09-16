export const PROTECTED_JOB_FIELDS = ["age_min", "age_max", "gender_pref"] as const;

// These are candidate-search filters, not fit signals — never let them reach the AI prompt.
export function assertNoProtectedFields(job: Record<string, unknown>) {
  for (const field of PROTECTED_JOB_FIELDS) {
    if (field in job) {
      throw new Error(`recommendShortlist: "${field}" must never reach the AI prompt.`);
    }
  }
}
