import { useRef, useState } from "react";
import { FileText, Loader2, FileSearch, Wand2, Upload, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import {
  parseResume,
  RESUME_SAFE_ERROR_MESSAGES,
  RESUME_SERVICE_UNAVAILABLE_MESSAGE,
  type ParsedResumePayload,
} from "@/lib/resume.functions";
import { RESUME_ACCEPT, validateResumeFile } from "@/lib/validators";
import { supabase } from "@/integrations/supabase/client";

export type ImportSource = "resume" | "linkedin_pdf" | "other";

const SOURCE_OPTIONS: { id: ImportSource; label: string }[] = [
  { id: "resume", label: "Resume" },
  { id: "linkedin_pdf", label: "LinkedIn PDF/export" },
  { id: "other", label: "Other document" },
];

type Props = {
  /** Candidate's user id — when provided, a provenance row is written to candidate_imports. */
  candidateId?: string | null;
  /** Called as soon as the file itself is validated — upload/save it here, independent of AI parsing. */
  onUploaded?: (file: File, source: ImportSource) => void;
  /** Called only if AI auto-fill succeeds. Never gates the file save. */
  onParsed: (data: ParsedResumePayload, file: File, source: ImportSource) => void;
  /** Existing resume filename, if one was already uploaded. */
  existingName?: string | null;
  /** Hide the source picker (defaults to shown) — for callers that always mean "resume". */
  hideSourcePicker?: boolean;
};

type Stage = "idle" | "uploading" | "reading" | "filling" | "done";

const STAGE_LABEL: Record<Exclude<Stage, "idle" | "done">, string> = {
  uploading: "Uploading your file…",
  reading: "Reading your resume…",
  filling: "Filling your details…",
};

const AUTOFILL_UNAVAILABLE_MESSAGE =
  "Resume uploaded successfully, but auto-fill is temporarily unavailable. You can continue manually.";

export function ResumeUpload({ candidateId, onUploaded, onParsed, existingName, hideSourcePicker }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<ImportSource>("resume");

  const busy = stage === "uploading" || stage === "reading" || stage === "filling";
  const handlePick = () => inputRef.current?.click();

  const handleFile = async (file: File) => {
    setError(null);
    setDone(null);
    const fileErr = validateResumeFile(file);
    if (fileErr) {
      setError(fileErr);
      return;
    }
    const name = file.name.toLowerCase();
    if (file.type === "application/msword" || (name.endsWith(".doc") && !name.endsWith(".docx"))) {
      setError("Old .doc files aren't supported. Please upload a PDF or DOCX instead.");
      return;
    }

    // The file itself is valid — save it now. This must succeed (or fail)
    // independently of whatever happens with AI parsing below.
    setStage("uploading");
    onUploaded?.(file, source);
    setDone(file.name);

    let importId: string | null = null;
    if (candidateId) {
      const { data } = await supabase
        .from("candidate_imports")
        .insert({
          candidate_id: candidateId, source, file_name: file.name,
          mime_type: file.type, size_bytes: file.size, status: "uploaded",
        })
        .select("id")
        .single();
      importId = data?.id ?? null;
    }

    try {
      const base64 = await fileToBase64(file);
      setStage("reading");
      const data = await parseResume({
        data: { fileName: file.name, mimeType: file.type, base64 },
      });
      setStage("filling");
      onParsed(data, file, source);
      setStage("done");
      toast.success("Resume parsed — review the auto-filled fields below.");
      if (importId) await supabase.from("candidate_imports").update({ status: "parsed" }).eq("id", importId);
    } catch (e) {
      // parseResume's server handler already normalizes AI-gateway/network
      // failures into one of the safe messages below before throwing — but
      // if the request never reached the server at all (offline, RPC
      // failure, etc.), e.message could still be a raw fetch/transport
      // string. Only ever show a message we recognize; anything else falls
      // back to the same calm copy so a candidate never sees technical text.
      // Either way, the file above is already saved — parsing is a
      // best-effort add-on, not a precondition, so we don't retry and we
      // don't roll the upload back.
      const msg = e instanceof Error && RESUME_SAFE_ERROR_MESSAGES.has(e.message)
        ? e.message
        : RESUME_SERVICE_UNAVAILABLE_MESSAGE;
      const notice = onUploaded ? AUTOFILL_UNAVAILABLE_MESSAGE : msg;
      setError(notice);
      setStage("done");
      if (importId) await supabase.from("candidate_imports").update({ status: "failed", error_code: msg.slice(0, 100) }).eq("id", importId);
      if (onUploaded) toast.info(notice);
      else toast.error(notice);
    }
  };

  const isAutofillNotice = error === AUTOFILL_UNAVAILABLE_MESSAGE;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Wand2 className="h-5 w-5" strokeWidth={2.25} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold text-foreground">Upload resume or LinkedIn PDF — auto-fill in seconds</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Drop your PDF, DOCX or a photo of your resume — or a PDF exported from LinkedIn — and we
            fill your basics, experience, skills and education. You can review and edit everything
            before it's saved; nothing overwrites your existing details silently.
          </p>

          {!hideSourcePicker && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {SOURCE_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  disabled={busy}
                  onClick={() => setSource(o.id)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    source === o.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-foreground/70 hover:border-primary/40"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handlePick}
              disabled={busy}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary-dark disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {busy ? "Working…" : existingName || done ? "Replace resume" : "Upload resume"}
            </button>
            {(done || existingName) && !busy && (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-success/10 px-2.5 py-1.5 text-xs font-semibold text-success">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {done ?? existingName}
              </span>
            )}
            <span className="text-xs text-muted-foreground">PDF / DOCX / PNG / JPG · max 5 MB</span>
          </div>

          {busy && (
            <div className="mt-4 space-y-2">
              {(["uploading", "reading", "filling"] as const).map((s, i) => {
                const order = ["uploading", "reading", "filling"];
                const currentIdx = order.indexOf(stage);
                const state = i < currentIdx ? "done" : i === currentIdx ? "active" : "todo";
                return (
                  <p
                    key={s}
                    className={`flex items-center gap-2 text-xs font-medium ${
                      state === "todo" ? "text-muted-foreground/50" : "text-foreground"
                    }`}
                  >
                    {state === "done" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                    ) : state === "active" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    ) : (
                      <FileSearch className="h-3.5 w-3.5" />
                    )}
                    {STAGE_LABEL[s]}
                  </p>
                );
              })}
              <p className="text-[11px] text-muted-foreground">
                Scanned files can take up to 20 seconds — hang tight.
              </p>
            </div>
          )}

          {error && (
            <p
              className={`mt-3 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ${
                isAutofillNotice ? "bg-muted text-muted-foreground" : "bg-destructive/10 text-destructive"
              }`}
            >
              <FileText className="h-3.5 w-3.5" /> {error}
            </p>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={RESUME_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.currentTarget.value = "";
        }}
      />
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = reader.result as string;
      // strip the data:<mime>;base64, prefix
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}
