export type MatchSegment = { text: string; matched: boolean };
export type MatchResult = { value: string; segments: MatchSegment[] };

const WORD_RE = /[A-Za-z0-9]+/g;

function wordsOf(s: string): { word: string; start: number }[] {
  const out: { word: string; start: number }[] = [];
  let m: RegExpExecArray | null;
  WORD_RE.lastIndex = 0;
  while ((m = WORD_RE.exec(s))) out.push({ word: m[0], start: m.index });
  return out;
}

function buildSegments(raw: string, q: string): MatchSegment[] {
  const words = wordsOf(raw);
  const ranges = words
    .filter((w) => w.word.toLowerCase().startsWith(q))
    .map((w) => [w.start, w.start + q.length] as const);
  if (!ranges.length) return [{ text: raw, matched: false }];

  const segments: MatchSegment[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) segments.push({ text: raw.slice(cursor, start), matched: false });
    segments.push({ text: raw.slice(start, end), matched: true });
    cursor = end;
  }
  if (cursor < raw.length) segments.push({ text: raw.slice(cursor), matched: false });
  return segments;
}

/**
 * Matches `query` against `pool` where any WORD in a candidate starts with the
 * (case-insensitive) query — not just an overall substring match. Results are
 * ranked whole-string-prefix matches first, then alphabetically, and capped at
 * `maxResults`. Each result carries highlight segments for the matched prefixes.
 */
export function matchSuggestions(query: string, pool: string[], maxResults = 8): MatchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const scored: { value: string; startsWhole: boolean }[] = [];
  for (const raw of pool) {
    const hasWordMatch = wordsOf(raw).some((w) => w.word.toLowerCase().startsWith(q));
    if (!hasWordMatch) continue;
    scored.push({ value: raw, startsWhole: raw.toLowerCase().startsWith(q) });
  }

  scored.sort((a, b) => {
    if (a.startsWhole !== b.startsWhole) return a.startsWhole ? -1 : 1;
    return a.value.localeCompare(b.value);
  });

  return scored
    .slice(0, maxResults)
    .map(({ value }) => ({ value, segments: buildSegments(value, q) }));
}
