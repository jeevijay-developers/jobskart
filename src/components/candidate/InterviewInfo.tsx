import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Calendar, ExternalLink, MapPin, Phone, Smartphone, Video } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { getJoinWindowState } from "@/lib/interview-window";
import { getCandidateJoinPayloadForOwnInterview } from "@/lib/interview.functions";

export type Interview = {
  id: string;
  scheduled_at: string;
  duration_min: number;
  mode: string;
  provider: string;
  status: string;
  location: string | null;
  meeting_url: string | null;
  notes: string | null;
};

const ICONS: Record<string, typeof Video> = { video: Video, phone: Phone, onsite: MapPin };

const STATUS_STYLE: Record<string, string> = {
  scheduled: "bg-primary-light text-primary",
  confirmed: "bg-primary-light text-primary",
  rescheduled: "bg-amber/10 text-amber",
  completed: "bg-success-light text-success",
  cancelled: "bg-surface text-muted-foreground",
};

type JoinInfo = { meetingUrl: string | null; zoomAppDeepLink: string | null };

/** Interview details for a single application — time-gated so a live/raw meeting link never sits on the page before it's actually usable. */
export function InterviewInfo({ interview }: { interview: Interview }) {
  const Icon = ICONS[interview.mode] ?? Calendar;
  const upcoming = new Date(interview.scheduled_at) > new Date();
  const isTerminal = interview.status === "cancelled" || interview.status === "completed";
  const getJoinPayload = useServerFn(getCandidateJoinPayloadForOwnInterview);

  const [now, setNow] = useState(() => new Date());
  const windowState = isTerminal
    ? null
    : getJoinWindowState(interview.scheduled_at, interview.duration_min, now);
  const [joinInfo, setJoinInfo] = useState<JoinInfo | null>(null);
  const [loadingJoin, setLoadingJoin] = useState(false);

  // Re-check every 30s so "too early" flips over to "join now" live, without a page refresh.
  useEffect(() => {
    if (isTerminal || windowState === "open") return;
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, [isTerminal, windowState]);

  useEffect(() => {
    if (windowState !== "open") {
      setJoinInfo(null);
      return;
    }
    let cancelled = false;
    setLoadingJoin(true);
    getJoinPayload({ data: { interviewId: interview.id } })
      .then((payload) => {
        if (cancelled) return;
        if (payload.windowState === "open" && "meetingUrl" in payload) {
          setJoinInfo({
            meetingUrl: payload.meetingUrl ?? null,
            zoomAppDeepLink:
              "zoomAppDeepLink" in payload ? (payload.zoomAppDeepLink ?? null) : null,
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingJoin(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowState, interview.id]);

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
          {interview.provider === "jobskart_zoom" ? "Video (JobsKart)" : interview.mode}
        </span>
        {interview.mode === "onsite" && interview.location && (
          <span className="text-muted-foreground">{interview.location}</span>
        )}
      </div>

      {windowState === "too_early" && (
        <p className="mt-3 rounded-lg bg-card p-3 text-xs text-muted-foreground">
          Join link activates 15 minutes before the interview starts.
        </p>
      )}

      {windowState === "expired" && (
        <p className="mt-3 rounded-lg bg-card p-3 text-xs text-muted-foreground">
          The interview window has passed. Contact the employer if you need a reschedule.
        </p>
      )}

      {interview.status === "cancelled" && (
        <p className="mt-3 rounded-lg bg-card p-3 text-xs text-muted-foreground">
          This interview was cancelled.
        </p>
      )}

      {windowState === "open" &&
        (interview.mode === "video" ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {loadingJoin ? (
              <span className="text-xs text-muted-foreground">Getting your join link…</span>
            ) : (
              <>
                {joinInfo?.zoomAppDeepLink && (
                  <a
                    href={joinInfo.zoomAppDeepLink}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-success px-3 text-xs font-bold text-success-foreground hover:opacity-90"
                  >
                    <Smartphone className="h-3.5 w-3.5" /> Open in Zoom app
                  </a>
                )}
                {joinInfo?.meetingUrl && (
                  <a
                    href={joinInfo.meetingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-bold ${
                      joinInfo.zoomAppDeepLink
                        ? "border border-success text-success hover:bg-success-light"
                        : "bg-success text-success-foreground hover:opacity-90"
                    }`}
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Join in browser
                  </a>
                )}
              </>
            )}
          </div>
        ) : (
          <p className="mt-3 rounded-lg bg-success-light p-3 text-xs font-semibold text-success">
            It's time —{" "}
            {interview.mode === "phone"
              ? "the employer will call you now."
              : "head to the interview location."}
          </p>
        ))}

      {interview.notes && <p className="mt-3 rounded-lg bg-card p-3 text-sm">{interview.notes}</p>}
    </div>
  );
}
