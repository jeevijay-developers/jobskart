// Structures a recruiter-entered, plain-text job description into labelled
// sections (Role Summary, Key Responsibilities, Job Requirements, and any of
// the optional sections a recruiter may have typed) without rewriting or
// dropping any of the original text. Only used as a fallback for legacy jobs
// that have `description` but no `description_html` (auto-generated JDs
// already ship structured HTML from src/lib/jd-template.ts).

type JdSection = {
  heading: string | null; // null = unlabelled intro text, rendered as a plain paragraph
  lines: string[]; // raw lines belonging to this section, in original order
};

// Canonical heading -> patterns a recruiter might have typed for it.
// Longest/most specific patterns first so "Job Requirements" doesn't match "Requirements" inside another heading.
const HEADING_PATTERNS: Array<{ canonical: string; test: RegExp }> = [
  { canonical: "Role Summary", test: /^(role\s*summary|job\s*summary|about\s*the\s*role|summary)\s*:?$/i },
  { canonical: "Key Responsibilities", test: /^(key\s*responsibilities|responsibilities|duties|roles?\s*(and|&)\s*responsibilities)\s*:?$/i },
  { canonical: "Job Requirements", test: /^(job\s*requirements|requirements|eligibility|eligibility\s*criteria)\s*:?$/i },
  { canonical: "Minimum Qualification", test: /^(minimum\s*qualification|qualification|education(al)?\s*qualification)\s*:?$/i },
  { canonical: "Experience", test: /^experience\s*:?$/i },
  { canonical: "Key Skills", test: /^(key\s*skills|skills\s*required|skills)\s*:?$/i },
  { canonical: "Shift / Availability", test: /^(shift\s*\/?\s*availability|shift|availability|working\s*hours)\s*:?$/i },
  { canonical: "Salary / Compensation", test: /^(salary\s*\/?\s*compensation|salary|compensation|pay|ctc)\s*:?$/i },
  { canonical: "Notes", test: /^notes?\s*:?$/i },
  { canonical: "Preferred Language", test: /^preferred\s*languages?\s*:?$/i },
  { canonical: "Preferred Industry", test: /^preferred\s*industr(y|ies)\s*:?$/i },
  { canonical: "Interview Details", test: /^interview\s*(details)?\s*:?$/i },
];

function matchHeading(line: string): string | null {
  const trimmed = line.trim().replace(/^\*\*(.+)\*\*$/, "$1"); // strip simple **bold** markdown wrapping
  if (!trimmed || trimmed.length > 60) return null; // headings are short lines
  for (const { canonical, test } of HEADING_PATTERNS) {
    if (test.test(trimmed)) return canonical;
  }
  return null;
}

const BULLET_RE = /^\s*[-*•]\s+/;

/** Splits raw description text into sections by recognized headings, preserving every original line. */
export function parseJdSections(raw: string): JdSection[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const sections: JdSection[] = [];
  let current: JdSection = { heading: null, lines: [] };

  for (const line of lines) {
    const heading = matchHeading(line);
    if (heading) {
      if (current.lines.some((l) => l.trim())) sections.push(current);
      else if (current.heading) sections.push(current); // keep empty labelled sections too
      current = { heading, lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.some((l) => l.trim()) || current.heading) sections.push(current);

  return sections;
}

function SectionBody({ lines }: { lines: string[] }) {
  // Group consecutive bullet lines into one <ul>; non-bullet runs become paragraphs.
  const blocks: Array<{ type: "ul" | "p"; items: string[] }> = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (BULLET_RE.test(line)) {
      const text = line.replace(BULLET_RE, "");
      const last = blocks[blocks.length - 1];
      if (last?.type === "ul") last.items.push(text);
      else blocks.push({ type: "ul", items: [text] });
    } else {
      const last = blocks[blocks.length - 1];
      if (last?.type === "p") last.items.push(line);
      else blocks.push({ type: "p", items: [line] });
    }
  }
  return (
    <>
      {blocks.map((b, i) =>
        b.type === "ul" ? (
          <ul key={i} className="mt-1 list-disc space-y-1 pl-5 marker:text-primary">
            {b.items.map((item, j) => (
              <li key={j} className="break-words text-sm leading-6 text-foreground/80">{item}</li>
            ))}
          </ul>
        ) : (
          <p key={i} className="mt-1 whitespace-pre-line break-words text-sm leading-6 text-foreground/80">
            {b.items.join("\n")}
          </p>
        ),
      )}
    </>
  );
}

/** Renders a plain-text job description as labelled sections where the recruiter used headings, falling back to plain paragraphs otherwise. Never invents or drops content. */
export function FormattedJobDescription({ text }: { text: string }) {
  const sections = parseJdSections(text);
  const hasAnyHeading = sections.some((s) => s.heading);

  if (!hasAnyHeading) {
    // No recognizable structure at all — preserve exactly as before, just with clean line-height.
    return <p className="whitespace-pre-line break-words text-sm leading-6 text-foreground/80">{text}</p>;
  }

  return (
    <div className="space-y-4">
      {sections.map((s, i) =>
        s.heading ? (
          <div key={i}>
            <h4 className="text-sm font-semibold text-foreground">{s.heading}</h4>
            <SectionBody lines={s.lines} />
          </div>
        ) : s.lines.some((l) => l.trim()) ? (
          <SectionBody key={i} lines={s.lines} />
        ) : null,
      )}
    </div>
  );
}
