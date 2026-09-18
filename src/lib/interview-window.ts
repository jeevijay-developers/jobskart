// Pure time-math, no I/O — safe to import from both client and server code.
//
// The valid join window covers the full interview duration plus a 15-minute
// buffer on each side, not a fixed +/-30min around the start time: for a
// 60-minute interview starting at 4:00pm, `scheduled_at + 30min` is 4:30pm —
// if either side's connection drops at 4:35pm and they refresh, a fixed
// +/-30min window would lock them out of their own still-running interview.

export type JoinWindowState = "too_early" | "open" | "expired";

const BUFFER_MIN = 15;

export function getJoinWindow(
  scheduledAtIso: string,
  durationMin: number,
): { opensAt: Date; closesAt: Date } {
  const scheduledAt = new Date(scheduledAtIso);
  const opensAt = new Date(scheduledAt.getTime() - BUFFER_MIN * 60_000);
  const closesAt = new Date(scheduledAt.getTime() + (durationMin + BUFFER_MIN) * 60_000);
  return { opensAt, closesAt };
}

export function getJoinWindowState(
  scheduledAtIso: string,
  durationMin: number,
  now: Date = new Date(),
): JoinWindowState {
  const { opensAt, closesAt } = getJoinWindow(scheduledAtIso, durationMin);
  if (now < opensAt) return "too_early";
  if (now > closesAt) return "expired";
  return "open";
}

export function isInsideJoinWindow(
  scheduledAtIso: string,
  durationMin: number,
  now: Date = new Date(),
): boolean {
  return getJoinWindowState(scheduledAtIso, durationMin, now) === "open";
}
