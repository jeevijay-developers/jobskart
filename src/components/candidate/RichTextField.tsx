import { useRef, useState } from "react";
import { Bold, Italic, List, Lightbulb, BookmarkPlus, X } from "lucide-react";
import { PHRASE_LIBRARY } from "@/lib/resumeBuilder/phraseLibrary";

// Constrained rich-text editor for resume free text. Formatting is stored as
// tiny markup (**bold**, *italic*, "- " bullets) — the same markup the PDF
// templates parse — so what the candidate formats is exactly what the live
// preview and the downloaded PDF render.
export function RichTextField({
  id,
  value,
  onChange,
  rows = 4,
  placeholder,
  suggestionKind,
  snippets = [],
  onSaveSnippet,
}: {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  placeholder?: string;
  suggestionKind?: "summaries" | "bullets";
  snippets?: string[];
  onSaveSnippet?: (text: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [panel, setPanel] = useState(false);
  const [group, setGroup] = useState(PHRASE_LIBRARY[0].id);

  const withSelection = (fn: (sel: string) => string) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const next = value.slice(0, a) + fn(value.slice(a, b)) + value.slice(b);
    onChange(next);
    requestAnimationFrame(() => el.focus());
  };

  const wrap = (mark: string) => withSelection((sel) => `${mark}${sel || "text"}${mark}`);
  const bullet = () => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const start = value.lastIndexOf("\n", a - 1) + 1;
    const endIdx = value.indexOf("\n", b);
    const end = endIdx === -1 ? value.length : endIdx;
    const block = value
      .slice(start, end)
      .split("\n")
      .map((l) => (l.trim().startsWith("- ") ? l : `- ${l}`))
      .join("\n");
    onChange(value.slice(0, start) + block + value.slice(end));
  };

  const insertText = (text: string) => {
    const joiner = value && !value.endsWith("\n") ? "\n" : "";
    onChange(`${value}${joiner}${suggestionKind === "bullets" ? "- " : ""}${text}`);
  };

  const phraseGroup = PHRASE_LIBRARY.find((g) => g.id === group) ?? PHRASE_LIBRARY[0];
  const phrases = suggestionKind === "summaries" ? phraseGroup.summaries : phraseGroup.bullets;

  const btn = "rounded p-1.5 text-muted-foreground hover:bg-surface hover:text-foreground";
  return (
    <div className="rounded-lg border border-border bg-background">
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1">
        <button type="button" className={btn} onClick={() => wrap("**")} title="Bold"><Bold className="h-3.5 w-3.5" /></button>
        <button type="button" className={btn} onClick={() => wrap("*")} title="Italic"><Italic className="h-3.5 w-3.5" /></button>
        <button type="button" className={btn} onClick={bullet} title="Bullet list"><List className="h-3.5 w-3.5" /></button>
        <span className="mx-1 h-4 w-px bg-border" />
        {suggestionKind && (
          <button type="button" className={`${btn} inline-flex items-center gap-1 text-[11px] font-medium`} onClick={() => setPanel((p) => !p)}>
            <Lightbulb className="h-3.5 w-3.5" /> Ideas
          </button>
        )}
        {onSaveSnippet && (
          <button
            type="button"
            className={`${btn} inline-flex items-center gap-1 text-[11px] font-medium`}
            onClick={() => value.trim() && onSaveSnippet(value.trim())}
            title="Save this text to reuse later"
          >
            <BookmarkPlus className="h-3.5 w-3.5" /> Save
          </button>
        )}
      </div>
      <textarea
        id={id}
        ref={ref}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full resize-y bg-transparent px-3 py-2 text-sm text-foreground outline-none"
      />
      {panel && (
        <div className="border-t border-border bg-surface/50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <select
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              className="rounded border border-border bg-background px-2 py-1 text-xs"
            >
              {PHRASE_LIBRARY.map((g) => (
                <option key={g.id} value={g.id}>{g.label}</option>
              ))}
            </select>
            <button type="button" onClick={() => setPanel(false)} className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="space-y-1.5">
            {phrases.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => insertText(p)}
                className="block w-full rounded border border-border bg-background px-2 py-1.5 text-left text-xs hover:border-primary/50"
              >
                {p.replace(/\*\*/g, "")}
              </button>
            ))}
            {snippets.length > 0 && (
              <p className="pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Your saved snippets</p>
            )}
            {snippets.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => insertText(p)}
                className="block w-full rounded border border-primary/30 bg-primary/5 px-2 py-1.5 text-left text-xs hover:border-primary"
              >
                {p.slice(0, 140)}
                {p.length > 140 ? "…" : ""}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
