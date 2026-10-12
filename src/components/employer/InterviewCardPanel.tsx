import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { IdCard, Loader2 } from "lucide-react";
import { getApplicantCard } from "@/lib/interview-card.functions";
import {
  BAND_LABELS,
  CATEGORY_LABELS,
  CRITERION_LABELS,
  type Criterion,
} from "@/lib/interview-prep";
import { SUMMARY_BAND_LABELS, type EmployerCard } from "@/lib/interview-card";

const bandTone = {
  needs_work: "bg-warning-light text-warning",
  developing: "bg-primary-light text-primary",
  strong: "bg-success-light text-success",
} as const;

const fmt = (s: number | null) =>
  s == null ? "" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * What an employer sees for an applicant who attached their Interview Card: the answers the
 * candidate chose to include (audio + text) and a content-only rubric. Access is checked in
 * Postgres and every open is logged; if the candidate detaches the card this simply errors.
 */
export function InterviewCardPanel({ applicationId }: { applicationId: string }) {
  const load = useServerFn(getApplicantCard);
  const [card, setCard] = useState<EmployerCard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCard(null);
    setError(null);
    load({ data: { applicationId } })
      .then((c) => !cancelled && setCard(c))
      .catch(
        (e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load the card."),
      );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId]);

  return (
    <div className="mt-5">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        <IdCard className="h-3.5 w-3.5" /> Interview Card
      </p>

      {!card && !error && (
        <div className="grid place-items-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      )}
      {error && <p className="mt-2 text-sm text-muted-foreground">{error}</p>}

      {card && (
        <div className="mt-2 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-surface px-2.5 py-1 font-semibold text-foreground/80">
              Role: {card.role_title}
            </span>
            {card.summary_band && (
              <span
                className={`rounded-full px-2.5 py-1 font-semibold ${bandTone[card.summary_band]}`}
              >
                Answer clarity: {SUMMARY_BAND_LABELS[card.summary_band]}
              </span>
            )}
            <span className="text-muted-foreground">
              {card.language === "hi" ? "Answered in Hindi" : "Answered in English"}
            </span>
          </div>

          <p className="rounded-lg border border-border bg-surface p-2.5 text-xs text-muted-foreground">
            The candidate chose these answers and recorded them in JobsKart. The ratings are an AI
            coaching rubric on how clearly each answer is structured. They don't measure accent,
            voice or personality, and aren't a hiring decision — please listen to the answers
            yourself.
          </p>

          {card.items.map((item) => (
            <div
              key={item.position}
              className="rounded-lg border border-border bg-card p-3 text-sm"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {CATEGORY_LABELS[item.category] ?? item.category}
                {item.duration_sec ? ` · ${fmt(item.duration_sec)}` : ""}
              </p>
              <p className="mt-0.5 font-medium text-foreground">{item.question}</p>
              {item.audioUrl && (
                <audio controls preload="none" src={item.audioUrl} className="mt-2 w-full" />
              )}
              {item.transcript && (
                <p className="mt-2 rounded-md bg-surface p-2 text-xs text-foreground/90">
                  {item.transcript}
                </p>
              )}
              {item.feedback && item.feedback.criteria.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {item.feedback.criteria.map((c) => (
                    <span
                      key={c.key}
                      title={c.evidence}
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${bandTone[c.band]}`}
                    >
                      {CRITERION_LABELS[c.key as Criterion] ?? c.key}: {BAND_LABELS[c.band]}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
