import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Lock, Mic, Pause, Play, Square, X } from "lucide-react";
import { MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS, VOICE_CONSENT_POINTS } from "@/lib/interview-prep";
import {
  getVoiceConsent,
  setVoiceConsent,
  transcribePrepAnswer,
} from "@/lib/interview-prep.functions";

type Phase = "loading" | "consent" | "idle" | "recording" | "paused" | "transcribing";

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function supported() {
  return (
    typeof window !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined"
  );
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(blob);
  });
}

/**
 * Opt-in "record and submit" voice answer. Nothing is uploaded until the candidate stops
 * recording; the server transcribes in memory and returns text for them to review and edit.
 * Typing is always available, so every failure here is recoverable by typing instead.
 */
export function VoiceRecorder({
  onTranscript,
  onCancel,
  defaultLanguage = "en",
}: {
  onTranscript: (text: string, durationSec: number, audioUrl: string) => void;
  onCancel: () => void;
  /** What language the candidate is likely to speak — independent of STT's own
   *  override below, this just seeds a sensible default (e.g. match the session's
   *  content language) rather than always starting from English. */
  defaultLanguage?: "en" | "hi";
}) {
  const fetchConsent = useServerFn(getVoiceConsent);
  const saveConsent = useServerFn(setVoiceConsent);
  const transcribe = useServerFn(transcribePrepAnswer);

  const [phase, setPhase] = useState<Phase>("loading");
  const [language, setLanguage] = useState<"en" | "hi">(defaultLanguage);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const mimeRef = useRef("audio/webm");
  const startedAt = useRef(0); // ms timestamp of current running segment
  const banked = useRef(0); // ms accumulated before the current segment
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const discard = useRef(false);

  const ok = supported();

  const releaseMic = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (tick.current) clearInterval(tick.current);
    tick.current = null;
  }, []);

  // Consent lookup runs once. Cleanup lives in its own effect with stable deps so a re-render
  // can never stop an in-progress recording.
  useEffect(() => {
    if (!ok) return;
    fetchConsent()
      .then((r) => setPhase(r.consented ? "idle" : "consent"))
      .catch(() => {
        setError("Voice isn't available right now. You can type your answer instead.");
        setPhase("consent");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok]);

  useEffect(
    () => () => {
      discard.current = true;
      if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
      releaseMic();
    },
    [releaseMic],
  );

  const seconds = () =>
    (banked.current + (startedAt.current ? Date.now() - startedAt.current : 0)) / 1000;

  const finish = useCallback(async () => {
    releaseMic();
    if (discard.current) return;
    const durationSec = Math.max(1, Math.round(banked.current / 1000));
    const blob = new Blob(chunks.current, { type: mimeRef.current });
    chunks.current = [];
    if (blob.size < 1000) {
      setError("We didn't catch any audio. Check your microphone and try again.");
      setPhase("idle");
      return;
    }
    if (blob.size > MAX_AUDIO_BYTES) {
      setError("That recording is too long. Keep answers under 2 minutes.");
      setPhase("idle");
      return;
    }
    setPhase("transcribing");
    try {
      const audioB64 = await blobToBase64(blob);
      const { transcript } = await transcribe({
        data: { audioB64, mime: mimeRef.current, durationSec, language },
      });
      // The blob itself is never uploaded anywhere beyond the transcription
      // call above — this Object URL just lets the candidate play back their
      // own recording for the rest of this browser tab's session; the caller
      // owns its lifetime (revoke on replace/unmount).
      onTranscript(transcript, durationSec, URL.createObjectURL(blob));
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "We couldn't turn your recording into text. You can try again, or type instead.",
      );
      setPhase("idle");
    }
  }, [language, onTranscript, releaseMic, transcribe]);

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
      banked.current = 0;
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      rec.onstop = () => void finish();
      recorder.current = rec;
      rec.start(1000);
      startedAt.current = Date.now();
      setElapsed(0);
      setPhase("recording");
      tick.current = setInterval(() => {
        const sec = seconds();
        setElapsed(sec);
        if (sec >= MAX_AUDIO_SECONDS) stop();
      }, 250);
    } catch {
      releaseMic();
      setError(
        "We couldn't use your microphone. Allow microphone access in your browser, or type your answer instead.",
      );
      setPhase("idle");
    }
  };

  const bank = () => {
    banked.current += Date.now() - startedAt.current;
    startedAt.current = 0;
  };
  const pause = () => {
    if (recorder.current?.state !== "recording") return;
    recorder.current.pause();
    bank();
    setElapsed(banked.current / 1000);
    setPhase("paused");
  };
  const resume = () => {
    if (recorder.current?.state !== "paused") return;
    recorder.current.resume();
    startedAt.current = Date.now();
    setPhase("recording");
  };
  function stop() {
    if (startedAt.current) bank();
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
  }
  const cancelRecording = () => {
    discard.current = true;
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    chunks.current = [];
    releaseMic();
    setPhase("idle");
  };

  const giveConsent = async (consent: boolean) => {
    try {
      await saveConsent({ data: { consent } });
      if (consent) {
        setError(null);
        setPhase("idle");
      } else onCancel();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your choice.");
    }
  };

  if (!ok)
    return (
      <div className="rounded-lg bg-surface p-4 text-sm">
        Voice answers aren't supported in this browser. Please type your answer instead.
        <button onClick={onCancel} className="ml-2 font-semibold text-primary">
          Back to typing
        </button>
      </div>
    );

  if (phase === "loading")
    return (
      <div className="grid place-items-center p-6">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );

  if (phase === "consent")
    return (
      <div className="rounded-lg border border-border bg-surface p-4 text-sm">
        <p className="flex items-center gap-2 font-semibold text-foreground">
          <Lock className="h-4 w-4 text-primary" /> Before you use voice
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-foreground/90">
          {VOICE_CONSENT_POINTS.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        {error && (
          <p role="alert" className="mt-2 text-destructive">
            {error}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => giveConsent(true)}
            className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
          >
            Turn on voice practice
          </button>
          <button
            onClick={onCancel}
            className="h-10 rounded-lg border border-border px-4 text-sm font-semibold"
          >
            Keep typing
          </button>
        </div>
      </div>
    );

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      {phase === "idle" && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label htmlFor="voice-lang" className="font-semibold text-foreground">
              Language
            </label>
            <select
              id="voice-lang"
              value={language}
              onChange={(e) => setLanguage(e.target.value as "en" | "hi")}
              className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
            >
              <option value="en">English</option>
              <option value="hi">Hindi / Hinglish (beta)</option>
            </select>
          </div>
          {language === "hi" && (
            <p className="mt-2 text-xs text-muted-foreground">
              Hindi support is in beta. Please check the text carefully before getting feedback.
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Up to 2 minutes. You'll review and can edit the text before feedback. You can play
            your recording back during this session — it's never saved anywhere and disappears
            when you leave or refresh this page.
          </p>
          {error && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={start}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
            >
              <Mic className="h-4 w-4" /> Start recording
            </button>
            <button
              onClick={onCancel}
              className="h-10 rounded-lg border border-border px-4 text-sm font-semibold"
            >
              Type instead
            </button>
            <button
              onClick={() => giveConsent(false)}
              className="h-10 px-2 text-xs font-semibold text-muted-foreground"
            >
              Turn voice off
            </button>
          </div>
        </>
      )}

      {(phase === "recording" || phase === "paused") && (
        <div className="flex flex-wrap items-center gap-3">
          <span
            role="timer"
            className="inline-flex items-center gap-2 text-lg font-semibold tabular-nums text-foreground"
          >
            <span
              aria-hidden
              className={`h-3 w-3 rounded-full ${phase === "recording" ? "animate-pulse bg-destructive" : "bg-muted-foreground"}`}
            />
            {fmt(elapsed)}{" "}
            <span className="text-xs font-normal text-muted-foreground">
              / {fmt(MAX_AUDIO_SECONDS)}
            </span>
          </span>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {phase === "recording" ? "Recording…" : "Paused"}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            {phase === "recording" ? (
              <button
                onClick={pause}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-semibold"
              >
                <Pause className="h-4 w-4" /> Pause
              </button>
            ) : (
              <button
                onClick={resume}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-semibold"
              >
                <Play className="h-4 w-4" /> Resume
              </button>
            )}
            <button
              onClick={stop}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
            >
              <Square className="h-4 w-4" /> Stop &amp; transcribe
            </button>
            <button
              onClick={cancelRecording}
              aria-label="Discard recording"
              className="inline-flex h-10 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-muted-foreground"
            >
              <X className="h-4 w-4" /> Discard
            </button>
          </div>
        </div>
      )}

      {phase === "transcribing" && (
        <p className="flex items-center gap-2 text-sm text-foreground" aria-live="polite">
          <Loader2 className="h-4 w-4 animate-spin text-primary" /> Turning your answer into text…
        </p>
      )}
    </div>
  );
}
