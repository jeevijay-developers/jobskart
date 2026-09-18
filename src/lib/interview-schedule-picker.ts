// Pure date/time helpers shared by ScheduleInterviewModal and
// RescheduleInterviewModal — split out of the component file so both modals
// can import it without triggering "file must only export components" fast
// refresh warnings.

// IST has a fixed +5:30 offset (no DST), so adding it to the UTC timestamp
// and reading the UTC getters back off the result gives IST wall-clock parts.
function istDateParts(date: Date): { y: number; m: number; d: number } {
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  return { y: ist.getUTCFullYear(), m: ist.getUTCMonth() + 1, d: ist.getUTCDate() };
}

function toDateInputValue({ y, m, d }: { y: number; m: number; d: number }): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function minIstDate(): string {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return toDateInputValue(istDateParts(tomorrow));
}

export const TIME_OPTIONS = Array.from({ length: 96 }, (_, i) => {
  const h = Math.floor(i / 4);
  const m = (i % 4) * 15;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
});
