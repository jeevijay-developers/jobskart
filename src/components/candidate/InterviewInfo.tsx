import { Calendar, MapPin, Video, Phone } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

export type Interview = {
  id: string;
  scheduled_at: string;
  mode: string;
  status: string;
  location: string | null;
  meeting_url: string | null;
  notes: string | null;
};

const ICONS: Record<string, typeof Video> = { video: Video, phone: Phone, onsite: MapPin };

const STATUS_STYLE: Record<string, string> = {
  scheduled: "bg-primary-light text-primary",
  confirmed: "bg-primary-light text-primary",
  completed: "bg-success-light text-success",
  rescheduled: "bg-amber/10 text-amber",
  cancelled: "bg-surface text-muted-foreground",
};

/** Interview details for a single application, ported from the former standalone /candidate/interviews page. */
export function InterviewInfo({ interview }: { interview: Interview }) {
  const Icon = ICONS[interview.mode] ?? Calendar;
  const upcoming = new Date(interview.scheduled_at) > new Date();

  return (
    <div className="rounded-xl border border-border bg-surface/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">
            {format(new Date(interview.scheduled_at), "eee, dd MMM yyyy · h:mm a")}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {upcoming
              ? `in ${formatDistanceToNow(new Date(interview.scheduled_at))}`
              : formatDistanceToNow(new Date(interview.scheduled_at), { addSuffix: true })}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-bold capitalize ${STATUS_STYLE[interview.status] || "bg-surface text-muted-foreground"}`}
        >
          {interview.status}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
        <span className="inline-flex items-center gap-1.5 capitalize">
          <Icon className="h-4 w-4 text-primary" />
          {interview.mode}
        </span>
        {interview.location && <span className="text-muted-foreground">{interview.location}</span>}
        {interview.meeting_url && (
          <a
            href={interview.meeting_url}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline"
          >
            Join link
          </a>
        )}
      </div>
      {interview.notes && <p className="mt-3 rounded-lg bg-card p-3 text-sm">{interview.notes}</p>}
    </div>
  );
}
