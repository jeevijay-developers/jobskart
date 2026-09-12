// Session-scoped "seen jobs" tracker for the "Similar jobs" anti-repetition
// rule: a candidate clicking through similar-job cards must not loop back
// onto jobs they've already been shown in this browsing session. Deliberately
// sessionStorage-only (per-tab, resets on new session) rather than a DB-backed
// view-history table — there's no other feature in this app needing durable
// view history, so building that infra now would be speculative.

const KEY = "jk_seen_jobs";
const MAX_TRACKED = 50; // cap growth across a long browsing session

export function getSeenJobIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function markJobSeen(jobId: string) {
  if (typeof window === "undefined") return;
  try {
    const ids = Array.from(getSeenJobIds());
    ids.push(jobId);
    window.sessionStorage.setItem(KEY, JSON.stringify(ids.slice(-MAX_TRACKED)));
  } catch {
    /* sessionStorage unavailable (private mode etc.) — anti-repeat just no-ops */
  }
}
