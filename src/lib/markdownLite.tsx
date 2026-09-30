// Renders a useful subset of Markdown as React elements — no dangerouslySetInnerHTML,
// no HTML parsing, no new dependency. Supports: #/##/### headings, **bold**, *italic*,
// `inline code`, [text](url) links, - / * bullet lists, 1. numbered lists, ``` code
// blocks, and paragraphs. Anything it doesn't recognise is shown as plain text, so
// content is never dropped even if the author used syntax beyond this subset.
//
// Deliberately not a full CommonMark implementation — content_posts.body_md is
// admin-authored (super_admin-only RLS) short-form article copy, not arbitrary
// third-party input, so this covers the realistic authoring surface without pulling
// in a markdown library and its HTML-sanitisation obligations.

type Segment = { text: string; bold?: boolean; italic?: boolean; code?: boolean; href?: string };

const INLINE_RE = /(\*\*.+?\*\*|\*.+?\*|`.+?`|\[[^\]]+\]\([^)]+\))/g;

function parseInline(text: string): Segment[] {
  const parts = text.split(INLINE_RE).filter((s) => s !== "");
  return parts.map((part) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return { text: part.slice(2, -2), bold: true };
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return { text: part.slice(1, -1), code: true };
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) return { text: link[1], href: link[2] };
    if (part.startsWith("*") && part.endsWith("*") && part.length >= 2 && !part.startsWith("**")) {
      return { text: part.slice(1, -1), italic: true };
    }
    return { text: part };
  });
}

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((seg, i) => {
        if (seg.href)
          return (
            <a
              key={i}
              href={seg.href}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline"
            >
              {seg.text}
            </a>
          );
        if (seg.code)
          return (
            <code key={i} className="rounded bg-surface px-1 py-0.5 text-[0.85em]">
              {seg.text}
            </code>
          );
        if (seg.bold) return <strong key={i}>{seg.text}</strong>;
        if (seg.italic) return <em key={i}>{seg.text}</em>;
        return <span key={i}>{seg.text}</span>;
      })}
    </>
  );
}

// "ul" and "ol" are kept as separate union members (not `"ul" | "ol"` on one
// member) so that narrowing `b.type === "ul"` then `b.type === "ol"` in two
// separate `if`s actually excludes both by the final fallback — TS doesn't
// narrow a shared-discriminant member across two independent checks.
type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "code"; text: string }
  | { type: "p"; text: string };

function parseBlocks(raw: string): Block[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: "p", text: paragraph.join(" ").trim() });
      paragraph = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushParagraph();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      blocks.push({ type: "code", text: code.join("\n") });
      i++; // skip closing fence
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2].trim(),
      });
      i++;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      flushParagraph();
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      flushParagraph();
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      i++;
      continue;
    }

    paragraph.push(trimmed);
    i++;
  }
  flushParagraph();
  return blocks;
}

const HEADING_CLASS: Record<1 | 2 | 3, string> = {
  1: "mt-6 text-xl font-bold text-foreground",
  2: "mt-5 text-lg font-bold text-foreground",
  3: "mt-4 text-base font-semibold text-foreground",
};

/** Renders body_md as formatted content. Falls back to plain paragraphs for anything unrecognised. */
export function FormattedMarkdown({ text }: { text: string }) {
  const blocks = parseBlocks(text ?? "");
  if (blocks.length === 0) return null;

  return (
    <div className="space-y-3">
      {blocks.map((b, i) => {
        if (b.type === "heading") {
          const Tag = `h${b.level}` as const as "h1" | "h2" | "h3";
          return (
            <Tag key={i} className={HEADING_CLASS[b.level]}>
              <Inline text={b.text} />
            </Tag>
          );
        }
        if (b.type === "ul")
          return (
            <ul key={i} className="list-disc space-y-1 pl-5 marker:text-primary">
              {b.items.map((item, j) => (
                <li key={j} className="text-sm leading-6 text-foreground/90">
                  <Inline text={item} />
                </li>
              ))}
            </ul>
          );
        if (b.type === "ol")
          return (
            <ol key={i} className="list-decimal space-y-1 pl-5 marker:text-primary">
              {b.items.map((item, j) => (
                <li key={j} className="text-sm leading-6 text-foreground/90">
                  <Inline text={item} />
                </li>
              ))}
            </ol>
          );
        if (b.type === "code")
          return (
            <pre key={i} className="overflow-x-auto rounded-lg bg-surface p-3 text-xs">
              <code>{b.text}</code>
            </pre>
          );
        return (
          <p key={i} className="text-sm leading-6 text-foreground/90">
            <Inline text={b.text} />
          </p>
        );
      })}
    </div>
  );
}
