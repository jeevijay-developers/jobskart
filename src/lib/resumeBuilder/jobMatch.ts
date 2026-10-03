// "Tailor to this job": deterministic keyword match between the candidate's
// resume and a JobsKart job posting. Pure + browser-safe. Only the
// candidate's own resume and a public job listing are involved, so (unlike
// recruiter-facing ranking) it is fine to compute client-side.
import type { ResumeSchema } from "./schema";
import { termsFor } from "./skillSynonyms";

export interface MatchJob {
  id: string;
  title: string;
  skills: string[] | null; // required
  preferred_skills?: string[] | null; // nice to have
  certifications: string[] | null;
}

export type SkillKind = "required" | "preferred";

// Required skills count double, so missing a nice-to-have costs less than
// missing something the employer needs. A job with no nice-to-have skills
// scores exactly as it did before they existed.
export const SKILL_WEIGHT: Record<SkillKind, number> = { required: 2, preferred: 1 };

export interface ResumeTextBlock {
  section: string;
  text: string; // lowercased plain text
  headline: boolean; // summary or target role
}

export interface MatchedSkill {
  skill: string;
  kind: SkillKind;
  sections: string[]; // where on the resume it was found
  via: string | null; // the alias that matched, when it isn't the skill's own name
}

export interface MissingSkill {
  skill: string;
  kind: SkillKind;
  // A fill-in-the-blank sentence. The candidate writes the real content; we never
  // insert text into the resume on their behalf.
  suggestion: string;
}

export interface JobMatchResult {
  score: number; // 0-100
  matched: MatchedSkill[];
  missing: MissingSkill[];
  titleMatch: boolean;
  // Whether the job title appears in the summary or target role — the places a
  // recruiter reads first. Shown as a hint only; it never changes the score.
  titleInHeadline: boolean;
}

export function resumeTextBlocks(resume: ResumeSchema): ResumeTextBlock[] {
  const blocks: ResumeTextBlock[] = [];
  if (resume.targetJobRole)
    blocks.push({
      section: "Target role",
      text: resume.targetJobRole.toLowerCase(),
      headline: true,
    });
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
    blocks.push({
      section: s.title || s.type,
      text: parts.join(" ").toLowerCase(),
      headline: s.type === "summary",
    });
  }
  return blocks;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function containsKeyword(haystack: string, keyword: string): boolean {
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
  // Required first, so a skill listed in both lists counts once, as required.
  const keywords: { skill: string; kind: SkillKind }[] = [];
  const seen = new Set<string>();
  const add = (list: string[] | null | undefined, kind: SkillKind) => {
    for (const raw of list ?? []) {
      const skill = raw.trim();
      const key = norm(skill);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      keywords.push({ skill, kind });
    }
  };
  add(job.skills, "required");
  add(job.certifications, "required");
  add(job.preferred_skills, "preferred");

  const matched: MatchedSkill[] = [];
  const missing: MissingSkill[] = [];
  for (const { skill: k, kind } of keywords) {
    const own = norm(k);
    const sections = new Set<string>();
    let via: string | null = null;
    for (const term of termsFor(own)) {
      for (const b of blocks) {
        if (!containsKeyword(b.text, term)) continue;
        sections.add(b.section);
        if (term !== own && via === null) via = term;
      }
    }
    const ownHit = blocks.some((b) => containsKeyword(b.text, own));
    if (sections.size > 0)
      matched.push({ skill: k, kind, sections: Array.from(sections), via: ownHit ? null : via });
    else missing.push({ skill: k, kind, suggestion: suggestionFor(k, certKeys.has(own)) });
  }

  const fullText = blocks.map((b) => b.text).join(" ");
  const titleWords = norm(job.title)
    .split(" ")
    .filter((w) => w.length > 2);
  const titleMatch = titleWords.length > 0 && titleWords.every((w) => containsKeyword(fullText, w));
  const headlineText = blocks
    .filter((b) => b.headline)
    .map((b) => b.text)
    .join(" ");
  const titleInHeadline =
    titleWords.length > 0 && titleWords.every((w) => containsKeyword(headlineText, w));

  const weightOf = (list: { kind: SkillKind }[]) =>
    list.reduce((sum, s) => sum + SKILL_WEIGHT[s.kind], 0);
  const totalWeight = weightOf(matched) + weightOf(missing);
  const score =
    totalWeight === 0
      ? titleMatch
        ? 100
        : 0
      : Math.round((weightOf(matched) / totalWeight) * 100);
  return { score, matched, missing, titleMatch, titleInHeadline };
}
