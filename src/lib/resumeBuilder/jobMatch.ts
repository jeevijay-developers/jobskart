// "Tailor to this job": deterministic keyword match between the candidate's
// resume and a JobsKart job posting. Pure + browser-safe. Only the
// candidate's own resume and a public job listing are involved, so (unlike
// recruiter-facing ranking) it is fine to compute client-side.
import type { ResumeSchema } from "./schema";

export interface MatchJob {
  id: string;
  title: string;
  skills: string[] | null;
  certifications: string[] | null;
}

export interface ResumeTextBlock {
  section: string;
  text: string; // lowercased plain text
}

export interface MatchedSkill {
  skill: string;
  sections: string[]; // where on the resume it was found
}

export interface MissingSkill {
  skill: string;
  // A fill-in-the-blank sentence. The candidate writes the real content; we never
  // insert text into the resume on their behalf.
  suggestion: string;
}

export interface JobMatchResult {
  score: number; // 0-100
  matched: MatchedSkill[];
  missing: MissingSkill[];
  titleMatch: boolean;
}

export function resumeTextBlocks(resume: ResumeSchema): ResumeTextBlock[] {
  const blocks: ResumeTextBlock[] = [];
  if (resume.targetJobRole)
    blocks.push({ section: "Target role", text: resume.targetJobRole.toLowerCase() });
  for (const s of resume.sections) {
    const parts: string[] = [];
    const c = s.content;
    switch (c.kind) {
      case "text":
        parts.push(c.value);
        break;
      case "list":
        parts.push(c.items.join(" "));
        break;
      case "experience":
        for (const e of c.items)
          parts.push(e.position, e.company, e.description, (e.achievements ?? []).join(" "));
        break;
      case "education":
        for (const e of c.items)
          parts.push(e.degree, e.fieldOfStudy ?? "", e.institution, e.description ?? "");
        break;
      case "certification":
        for (const e of c.items) parts.push(e.name, e.issuingOrganization ?? "");
        break;
      case "link":
        break;
    }
    blocks.push({ section: s.title || s.type, text: parts.join(" ").toLowerCase() });
  }
  return blocks;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function containsKeyword(haystack: string, keyword: string): boolean {
  const k = norm(keyword);
  if (!k) return false;
  const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Word-ish boundaries so "java" doesn't match "javascript".
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(haystack);
}

export function suggestionFor(keyword: string, isCertification: boolean): string {
  return isCertification
    ? `Completed ${keyword} ([provider], [year]).`
    : `Used ${keyword} to [what you built or improved], resulting in [outcome].`;
}

export function computeJobMatch(resume: ResumeSchema, job: MatchJob): JobMatchResult {
  const blocks = resumeTextBlocks(resume);
  const certKeys = new Set((job.certifications ?? []).map(norm));
  const keywords = Array.from(
    new Map(
      [...(job.skills ?? []), ...(job.certifications ?? [])].map((k) => [norm(k), k.trim()]),
    ).values(),
  ).filter(Boolean);

  const matched: MatchedSkill[] = [];
  const missing: MissingSkill[] = [];
  for (const k of keywords) {
    const sections = Array.from(
      new Set(blocks.filter((b) => containsKeyword(b.text, k)).map((b) => b.section)),
    );
    if (sections.length > 0) matched.push({ skill: k, sections });
    else missing.push({ skill: k, suggestion: suggestionFor(k, certKeys.has(norm(k))) });
  }

  const fullText = blocks.map((b) => b.text).join(" ");
  const titleWords = norm(job.title)
    .split(" ")
    .filter((w) => w.length > 2);
  const titleMatch = titleWords.length > 0 && titleWords.every((w) => fullText.includes(w));

  const score =
    keywords.length === 0
      ? titleMatch
        ? 100
        : 0
      : Math.round((matched.length / keywords.length) * 100);
  return { score, matched, missing, titleMatch };
}
