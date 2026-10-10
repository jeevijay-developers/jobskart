// Single type -> destination mapping for candidate notifications (Point 16).
// Add a new notification `type` here, not inline at each call site.
//
// Data check (done against the real schema before writing this file): the
// `notifications` table (20260622093545_...) originally had only id,
// user_id, type, title, body, link, read_at, created_at, image_url — no
// application_id. 20261010200000_notifications_application_id.sql adds a
// nullable application_id, populated going forward by
// tg_applications_after_update() / tg_interviews_notify(), plus a best-effort
// backfill of old rows where the match was unique and unambiguous (verified
// against live data before writing that migration). Some old rows may still
// have application_id = NULL (no reliable match existed) — those fall back
// to "expand", same as before this column existed. `link` is still a bare
// path string written once per type:
//   - application.status           -> '/candidate/applications'
//   - interview.scheduled           -> '/candidate/interviews'
//   - candidate.invited_to_apply    -> '/jobs/' || job_id (id IS present, in the path)
export type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
  application_id?: string | null;
};

export type NotificationDestination = { kind: "navigate"; to: string } | { kind: "expand" };

const JOB_LINK_RE = /^\/jobs\/([0-9a-f-]{36})$/i;

/**
 * type + link + application_id -> where clicking this notification should go.
 * - candidate.invited_to_apply (job_id recoverable from link): candidate job
 *   detail page, with ?notification=<id> so that page's banner can show it.
 * - application.status / interview.scheduled WITH an application_id:
 *   Applications page, with ?application=<id>&notification=<id> so that
 *   page highlights/scrolls to the exact card and shows the banner.
 * - application.status / interview.scheduled WITHOUT one (old row, no
 *   reliable backfill match): expand in place on the Notifications page —
 *   there is nothing to link to.
 * - any other type with a link: keep that link, append ?notification=<id>
 *   (same param every destination's banner looks for).
 * - any other type with no link: expand in place.
 */
export function resolveNotificationDestination(n: NotificationRow): NotificationDestination {
  if (n.type === "candidate.invited_to_apply") {
    const m = n.link ? JOB_LINK_RE.exec(n.link) : null;
    if (m) {
      return { kind: "navigate", to: `/candidate/jobs/${m[1]}?notification=${n.id}` };
    }
    // Shouldn't happen given how this type is written today, but fall back
    // to expand rather than navigate somewhere that can't show the banner.
    return { kind: "expand" };
  }

  if (n.type === "application.status" || n.type === "interview.scheduled") {
    if (n.application_id) {
      return {
        kind: "navigate",
        to: `/candidate/applications?application=${n.application_id}&notification=${n.id}`,
      };
    }
    return { kind: "expand" };
  }

  if (n.link) {
    const sep = n.link.includes("?") ? "&" : "?";
    return { kind: "navigate", to: `${n.link}${sep}notification=${n.id}` };
  }

  return { kind: "expand" };
}
