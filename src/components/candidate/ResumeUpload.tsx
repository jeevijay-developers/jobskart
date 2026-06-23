import { useRef, useState } from "react";
import { FileText, Loader2, Sparkles as Wand2, Upload, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { parseResume, type ParsedResumePayload } from "@/lib/resume.functions";
import { RESUME_ACCEPT, validateResumeFile } from "@/lib/validators";

type Props = {
  onParsed: (data: ParsedResumePayload, file: File) => void;
};

export function ResumeUpload({ onParsed }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePick = () => inputRef.current?.click();

  const handleFile = async (file: File) => {
    setError(null);
    setDone(null);
    const fileErr = validateResumeFile(file);
    if (fileErr) {
      setError(fileErr);
      return;
    }
    if (file.type !== "application/pdf") {
      // Non-PDF uploads are accepted, but AI parsing only works on PDFs today.
      onParsed({ skills: [], experiences: [], education: [] }, file);
      setDone(file.name);
      toast.success("Resume uploaded. PDF is needed for auto-fill.");
      return;
    }
    setLoading(true);
    try {
      const base64 = await fileToBase64(file);
      const data = await parseResume({
        data: { fileName: file.name, mimeType: file.type, base64 },
      });
      onParsed(data, file);
      setDone(file.name);
      toast.success("Resume parsed — review the auto-filled fields below.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not parse resume.";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Wand2 className="h-5 w-5" strokeWidth={2.25} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold text-foreground">Upload resume — auto-fill in seconds</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Drop your PDF and our AI fills your basics, experience, skills and education. You can edit anything afterward.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handlePick}
              disabled={loading}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary-dark disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {loading ? "Parsing…" : "Upload resume PDF"}
            </button>
            {done && (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-success/10 px-2.5 py-1.5 text-xs font-semibold text-success">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {done}
              </span>
            )}
            <span className="text-xs text-muted-foreground">PDF · max 10 MB</span>
          </div>

          {error && (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs font-medium text-destructive">
              <FileText className="h-3.5 w-3.5" /> {error}
            </p>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
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
