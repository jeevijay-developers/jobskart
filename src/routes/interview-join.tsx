import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Calendar, ExternalLink, Loader2, Smartphone, Video } from "lucide-react";
import { format } from "date-fns";
import { Navbar } from "@/components/site/Navbar";
import { useIsMobile } from "@/hooks/use-mobile";
import { getCandidateJoinPayloadByToken } from "@/lib/interview.functions";

const searchSchema = z.object({ t: z.string().optional() });

export const Route = createFileRoute("/interview-join")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: "Join your interview · JobsKart" }] }),
  component: InterviewJoinPage,
});

type JoinPayload = Awaited<ReturnType<typeof getCandidateJoinPayloadByToken>>;

function errorMessage(message: string): string {
  if (message.includes("invalid_join_link:expired")) return "This join link has expired.";
  if (message.includes("invalid_join_link"))
    return "This join link isn't valid. Ask the employer to resend it.";
  return "This interview is no longer active.";
}

function InterviewJoinPage() {
  const { t } = Route.useSearch();
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<JoinPayload | null>(null);

  useEffect(() => {
    if (!t) {
      setError("This link is missing its access token.");
      setLoading(false);
      return;
    }
    getCandidateJoinPayloadByToken({ data: { token: t } })
      .then((p) => setPayload(p))
      .catch((e) => setError(errorMessage(e instanceof Error ? e.message : "")))
      .finally(() => setLoading(false));
  }, [t]);

  return (
    <div className="min-h-screen bg-surface">
      <Navbar />
      <main className="mx-auto max-w-md px-4 py-16">
        <div className="rounded-2xl border border-border bg-card p-8 shadow-[var(--shadow-card)] text-center">
          {loading ? (
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : !payload ? (
            <p className="text-sm text-muted-foreground">Interview not found.</p>
          ) : (
            <JoinCard payload={payload} isMobile={isMobile} />
          )}
        </div>
      </main>
    </div>
  );
}

function JoinCard({ payload, isMobile }: { payload: JoinPayload; isMobile: boolean }) {
  return (
    <div>
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-primary-light text-primary">
        <Video className="h-7 w-7" />
      </div>
      <h1 className="mt-4 text-lg font-bold text-foreground">
        {payload.jobTitle ? `Interview for ${payload.jobTitle}` : "Your interview"}
      </h1>
      {payload.companyName && (
        <p className="text-sm text-muted-foreground">{payload.companyName}</p>
      )}
      <p className="mt-2 flex items-center justify-center gap-1.5 text-sm text-foreground">
        <Calendar className="h-4 w-4 text-primary" />
        {format(new Date(payload.scheduledAt), "eee, dd MMM yyyy · h:mm a")}
      </p>

      {payload.windowState === "too_early" && (
        <p className="mt-6 rounded-lg bg-surface p-3 text-xs text-muted-foreground">
          This link activates 15 minutes before your interview starts. Come back then.
        </p>
      )}

      {payload.windowState === "expired" && (
        <p className="mt-6 rounded-lg bg-surface p-3 text-xs text-muted-foreground">
          This interview window has passed. Contact the employer if you need a reschedule.
        </p>
      )}

      {payload.windowState === "open" && payload.mode !== "video" && (
        <p className="mt-6 rounded-lg bg-success-light p-3 text-sm font-semibold text-success">
          It's time —{" "}
          {payload.mode === "phone"
            ? "the employer will call you now."
            : "head to the interview location."}
        </p>
      )}

      {payload.windowState === "open" && payload.mode === "video" && "meetingUrl" in payload && (
        <div className="mt-6 space-y-2">
          {isMobile && "zoomAppDeepLink" in payload && payload.zoomAppDeepLink && (
            <a
              href={payload.zoomAppDeepLink}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-success text-sm font-bold text-success-foreground hover:opacity-90"
            >
              <Smartphone className="h-4 w-4" /> Open in Zoom app
            </a>
          )}
          {payload.meetingUrl && (
            <a
              href={payload.meetingUrl}
              target="_blank"
              rel="noreferrer"
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-success text-sm font-bold text-success hover:bg-success-light"
            >
              <ExternalLink className="h-4 w-4" /> Join in browser
            </a>
          )}
        </div>
      )}
    </div>
  );
}
