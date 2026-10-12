import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { CheckCircle2, Eye, IdCard, Loader2, Lock, Mic, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { CandidateShell } from "@/components/candidate/CandidateShell";
import { CardAnswerRecorder } from "@/components/candidate/CardAnswerRecorder";
import { AutocompleteInput } from "@/components/site/AutocompleteInput";
import { useJobTitleSuggestions } from "@/lib/useJobTitleSuggestions";
import { BAND_LABELS, CATEGORY_LABELS } from "@/lib/interview-prep";
import {
  CARD_CONSENT_POINTS,
  CARD_MIN_INCLUDED,
  SUMMARY_BAND_LABELS,
  canPublish,
  takesLeft,
  type CandidateCard,
  type CandidateCardItem,
} from "@/lib/interview-card";
import {
  deleteCard,
  getCardState,
  publishCard,
  setCardConsent,
  setCardItemIncluded,
  startCard,
  submitCardAnswer,
} from "@/lib/interview-card.functions";

export const Route = createFileRoute("/_authenticated/candidate/interview-card")({
  head: () => ({ meta: [{ title: "Interview Card · JobsKart" }] }),
  component: InterviewCardPage,
});

type State = Awaited<ReturnType<typeof getCardState>>;

const bandTone = {
  needs_work: "bg-warning-light text-warning",
  developing: "bg-primary-light text-primary",
  strong: "bg-success-light text-success",
} as const;

function InterviewCardPage() {
  const fetchState = useServerFn(getCardState);
  const saveConsent = useServerFn(setCardConsent);
  const start = useServerFn(startCard);
  const submit = useServerFn(submitCardAnswer);
  const include = useServerFn(setCardItemIncluded);
  const publish = useServerFn(publishCard);
  const remove = useServerFn(deleteCard);
  const jobTitles = useJobTitleSuggestions();

  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [role, setRole] = useState("");
  const [language, setLanguage] = useState<"en" | "hi">("en");
  const [activeItem, setActiveItem] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await fetchState();
      setState(s);
      setLoadError(false);
      if (s.card) setLanguage(s.card.language);
    } catch {
      setLoadError(true);
    }
  }, [fetchState]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(key);
    try {
      await fn();
      if (okMsg) toast.success(okMsg);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  const card = state?.card ?? null;

  return (
    <CandidateShell
      title="Interview Card"
      subtitle="Record a short voice interview once, then choose which applications to attach it to."
    >
      <p className="mb-6 flex items-start gap-2 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <span>
          Only employers you attach the card to can see it, and only the answers you include. Having
          a card never counts against you if you don't have one. Looking for private practice
          instead?{" "}
          <Link
            to="/candidate/interview-prep"
            className="font-semibold text-primary hover:underline"
          >
            Go to Interview prep
          </Link>
          .
        </span>
      </p>

      {!state ? (
        <div className="grid place-items-center rounded-xl border border-border bg-card p-12">
          {loadError ? (
            <p className="text-sm text-muted-foreground">
              Couldn't load your card.{" "}
              <button onClick={load} className="font-semibold text-primary">
                Try again
              </button>
            </p>
          ) : (
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          )}
        </div>
      ) : !state.consented ? (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <IdCard className="h-5 w-5 text-primary" /> Before you start
          </h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-foreground/90">
            {CARD_CONSENT_POINTS.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <button
            onClick={() => run("consent", () => saveConsent({ data: { consent: true } }))}
            disabled={busy === "consent"}
            className="mt-4 h-10 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {busy === "consent" ? "Saving…" : "I agree — set up my card"}
          </button>
        </section>
      ) : !card ? (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-lg font-semibold text-foreground">Create your Interview Card</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            You'll answer about 5 questions by voice, up to 90 seconds each. You get one retake per
            question. The questions depend on the role, so every candidate for a role answers the
            same ones.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <AutocompleteInput
              value={role}
              onChange={setRole}
              onSubmit={() => undefined}
              suggestions={jobTitles}
              maxLength={80}
              placeholder="Role you want to be interviewed for"
              wrapperClassName="relative min-w-0 flex-1"
              inputClassName="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"
              aria-label="Role"
            />
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as "en" | "hi")}
              aria-label="Language"
              className="h-10 rounded-lg border border-border bg-background px-2 text-sm"
            >
              <option value="en">English</option>
              <option value="hi">Hindi</option>
            </select>
            <button
              onClick={() => run("start", () => start({ data: { roleTitle: role, language } }))}
              disabled={busy === "start" || role.trim().length < 2}
              className="h-10 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {busy === "start" ? "Starting…" : "Start"}
            </button>
          </div>
        </section>
      ) : (
        <CardEditor
          card={card}
          busy={busy}
          activeItem={activeItem}
          setActiveItem={setActiveItem}
          onSubmitAnswer={(item, audioB64, mime, durationSec) =>
            run(
              `answer-${item.id}`,
              async () => {
                await submit({ data: { itemId: item.id, audioB64, mime, durationSec } });
                setActiveItem(null);
              },
              "Answer saved.",
            )
          }
          onInclude={(item, v) =>
            run(`inc-${item.id}`, () => include({ data: { itemId: item.id, include: v } }))
          }
          onPublish={() => run("publish", () => publish(), "Your Interview Card is published.")}
          onDelete={() => {
            if (
              window.confirm(
                "Delete your Interview Card and all recordings? It will be removed from every application it's attached to.",
              )
            )
              void run("delete", () => remove(), "Interview Card deleted.");
          }}
        />
      )}

      {state?.consented && (
        <section className="mt-8">
          <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold text-foreground">
            <Eye className="h-4 w-4 text-primary" /> Who viewed your card
          </h2>
          {state.views.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No views yet. Attach your card when you apply to a job and employers can open it.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {state.views.map((v, i) => (
                <li
                  key={i}
                  className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
                >
                  <span>
                    <span className="font-semibold text-foreground">{v.company_name}</span>{" "}
                    <span className="text-muted-foreground">· {v.job_title}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(v.viewed_at), { addSuffix: true })}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-6 text-xs text-muted-foreground">
            Changed your mind?{" "}
            <button
              onClick={() => {
                if (
                  window.confirm(
                    "Withdraw consent? Your card and all recordings will be deleted and removed from every application.",
                  )
                )
                  void run(
                    "withdraw",
                    () => saveConsent({ data: { consent: false } }),
                    "Consent withdrawn. Your card was deleted.",
                  );
              }}
              className="font-semibold text-primary hover:underline"
            >
              Withdraw consent and delete everything
            </button>
          </p>
        </section>
      )}
    </CandidateShell>
  );
}

function CardEditor({
  card,
  busy,
  activeItem,
  setActiveItem,
  onSubmitAnswer,
  onInclude,
  onPublish,
  onDelete,
}: {
  card: CandidateCard;
  busy: string | null;
  activeItem: string | null;
  setActiveItem: (id: string | null) => void;
  onSubmitAnswer: (item: CandidateCardItem, b64: string, mime: string, sec: number) => void;
  onInclude: (item: CandidateCardItem, include: boolean) => void;
  onPublish: () => void;
  onDelete: () => void;
}) {
  const published = card.status === "published";
  const answered = card.items.filter((i) => i.state === "answered").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
        <div>
          <p className="text-sm text-muted-foreground">Role</p>
          <p className="font-semibold text-foreground">{card.role_title}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {published ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success-light px-3 py-1 font-semibold text-success">
              <CheckCircle2 className="h-4 w-4" /> Published
              {card.summary_band && ` · ${SUMMARY_BAND_LABELS[card.summary_band]}`}
            </span>
          ) : (
            <span className="rounded-full bg-surface px-3 py-1 font-semibold text-muted-foreground">
              Draft · {answered}/{card.items.length} answered
            </span>
          )}
          <button
            onClick={onDelete}
            disabled={busy === "delete"}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete card
          </button>
        </div>
      </div>

      {published && (
        <p className="rounded-xl border border-success/30 bg-success-light/40 p-3 text-sm text-foreground/90">
          Your card is ready. When you apply to a job, switch on "Attach my Interview Card". You can
          change which answers are included below at any time (keep at least {CARD_MIN_INCLUDED}).
          To re-record, delete this card and start a new one.
        </p>
      )}

      <ol className="space-y-3">
        {card.items.map((item) => {
          const isAnswered = item.state === "answered";
          const open = activeItem === item.id;
          const left = takesLeft(item.takes);
          return (
            <li key={item.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {item.position}. {CATEGORY_LABELS[item.category] ?? item.category}
                  </p>
                  <p className="mt-0.5 font-medium text-foreground">{item.question_text}</p>
                </div>
                {isAnswered && (
                  <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={item.include}
                      disabled={busy === `inc-${item.id}`}
                      onChange={(e) => onInclude(item, e.target.checked)}
                      className="h-4 w-4 accent-primary"
                    />
                    Include in my card
                  </label>
                )}
              </div>

              {isAnswered && (
                <div className="mt-3 space-y-2">
                  {item.audioUrl && <audio controls src={item.audioUrl} className="w-full" />}
                  {item.transcript && (
                    <p className="rounded-lg bg-surface p-3 text-sm text-foreground/90">
                      {item.transcript}
                    </p>
                  )}
                  {item.feedback && (
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap gap-1.5">
                        {item.feedback.criteria.map((c) => (
                          <span
                            key={c.key}
                            title={c.evidence}
                            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${bandTone[c.band]}`}
                          >
                            {c.key}: {BAND_LABELS[c.band]}
                          </span>
                        ))}
                      </div>
                      {item.feedback.improvements[0] && (
                        <p className="text-xs text-muted-foreground">
                          Tip (only you see this): {item.feedback.improvements[0]}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {!published && (!isAnswered || left > 0) && (
                <div className="mt-3">
                  {open ? (
                    <CardAnswerRecorder
                      retakesLeft={left - 1}
                      submitting={busy === `answer-${item.id}`}
                      onSubmit={(b64, mime, sec) => onSubmitAnswer(item, b64, mime, sec)}
                    />
                  ) : (
                    <button
                      onClick={() => setActiveItem(item.id)}
                      className="inline-flex h-9 items-center gap-2 rounded-lg border border-primary/40 px-3 text-sm font-semibold text-primary hover:bg-primary-light/50"
                    >
                      <Mic className="h-4 w-4" />
                      {isAnswered ? "Use my retake" : "Record answer"}
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {!published && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
          <button
            onClick={onPublish}
            disabled={!canPublish(card.items) || busy === "publish"}
            className="h-10 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy === "publish" ? "Publishing…" : "Publish my Interview Card"}
          </button>
          <p className="text-xs text-muted-foreground">
            Answer and include at least {CARD_MIN_INCLUDED} questions. Publishing doesn't share it
            with anyone — you choose that per application.
          </p>
        </div>
      )}
    </div>
  );
}
