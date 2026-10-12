import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, RotateCcw, Send, Square } from "lucide-react";
import { CARD_MAX_SECONDS } from "@/lib/interview-card";
import { MAX_AUDIO_BYTES } from "@/lib/interview-prep";

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const supported = () =>
  typeof window !== "undefined" &&
  !!navigator.mediaDevices?.getUserMedia &&
  typeof MediaRecorder !== "undefined";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(blob);
  });
}

type Phase = "idle" | "recording" | "review";

/**
 * Records one Interview Card answer inside the app (no file upload, so the answer is
 * genuinely spoken now). The candidate can listen back, then either submit it or — if a
 * retake is still available — record again. Submission is the caller's job.
 */
export function CardAnswerRecorder({
  retakesLeft,
  submitting,
  onSubmit,
}: {
  /** Retakes still available for this question, counting only answers already submitted. */
  retakesLeft: number;
  submitting: boolean;
  onSubmit: (audioB64: string, mime: string, durationSec: number) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [localRetakes, setLocalRetakes] = useState(0); // discards before submitting also use a retake
  const [preview, setPreview] = useState<{ url: string; blob: Blob; sec: number } | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const mimeRef = useRef("audio/webm");
  const startedAt = useRef(0);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const discard = useRef(false);

  const available = retakesLeft - localRetakes;

  const release = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (tick.current) clearInterval(tick.current);
    tick.current = null;
  }, []);

  useEffect(
    () => () => {
      discard.current = true;
      if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
      release();
    },
    [release],
  );
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview.url)), [preview]);

  const finish = useCallback(() => {
    release();
    if (discard.current) return;
    const sec = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
    const blob = new Blob(chunks.current, { type: mimeRef.current });
    chunks.current = [];
    if (blob.size < 1000) {
      setError("We didn't catch any audio. Check your microphone and try again.");
      setPhase("idle");
      return;
    }
    if (blob.size > MAX_AUDIO_BYTES) {
      setError("That recording is too long. Keep it under 90 seconds.");
      setPhase("idle");
      return;
    }
    setPreview({ url: URL.createObjectURL(blob), blob, sec: Math.min(sec, CARD_MAX_SECONDS) });
    setPhase("review");
  }, [release]);

  const stop = useCallback(() => {
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
  }, []);

  const start = async () => {
    setError(null);
    discard.current = false;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      const mimeType = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(s, mimeType ? { mimeType } : undefined);
      mimeRef.current = rec.mimeType || mimeType || "audio/webm";
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      rec.onstop = finish;
      recorder.current = rec;
      rec.start(1000);
      startedAt.current = Date.now();
      setElapsed(0);
      setPhase("recording");
      tick.current = setInterval(() => {
        const sec = (Date.now() - startedAt.current) / 1000;
        setElapsed(sec);
        if (sec >= CARD_MAX_SECONDS) stop();
      }, 250);
    } catch {
      release();
      setError(
        "We couldn't use your microphone. Allow microphone access in your browser and try again.",
      );
      setPhase("idle");
    }
  };

  const recordAgain = () => {
    setPreview(null);
    setLocalRetakes((n) => n + 1);
    setPhase("idle");
  };

  const submit = async () => {
    if (!preview) return;
    try {
      onSubmit(await blobToBase64(preview.blob), mimeRef.current, preview.sec);
    } catch {
      setError("We couldn't read your recording. Please record again.");
    }
  };

  if (!supported())
    return (
      <p className="rounded-lg bg-surface p-3 text-sm">
        Recording isn't supported in this browser. Please open JobsKart in Chrome, Edge or Safari on
        your phone or computer.
      </p>
    );

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      {phase === "idle" && (
        <>
          <p className="text-xs text-muted-foreground">
            Up to {CARD_MAX_SECONDS} seconds. Speak naturally, as you would in a real interview.
            {available > 0
              ? ` If you re-record, that uses your one retake.`
              : " This is your last attempt for this question."}
          </p>
          <button
            onClick={start}
            className="mt-2 inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
          >
            <Mic className="h-4 w-4" /> Start recording
          </button>
        </>
      )}

      {phase === "recording" && (
        <div className="flex flex-wrap items-center gap-3">
          <span
            role="timer"
            className="inline-flex items-center gap-2 text-lg font-semibold tabular-nums"
          >
            <span aria-hidden className="h-3 w-3 animate-pulse rounded-full bg-destructive" />
            {fmt(elapsed)}
            <span className="text-xs font-normal text-muted-foreground">
              / {fmt(CARD_MAX_SECONDS)}
            </span>
          </span>
          <button
            onClick={stop}
            className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
          >
            <Square className="h-4 w-4" /> Stop
          </button>
        </div>
      )}

      {phase === "review" && preview && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-foreground">Listen back ({fmt(preview.sec)})</p>
          <audio controls src={preview.url} className="w-full" />
          <div className="flex flex-wrap gap-2">
            <button
              onClick={submit}
              disabled={submitting}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {submitting ? "Saving…" : "Submit this answer"}
            </button>
            {available > 0 && (
              <button
                onClick={recordAgain}
                disabled={submitting}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold disabled:opacity-60"
              >
                <RotateCcw className="h-4 w-4" /> Record again (uses your retake)
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
