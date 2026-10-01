// "Tailor to this job": deterministic keyword match between the candidate's
// resume and a JobsKart job posting. Pure + browser-safe. Only the
// candidate's own resume and a public job listing are involved, so (unlike
// recruiter-facing ranking) it is fine to compute client-side.
import type { ResumeSchema } from './schema';

export interface MatchJob {
  id: string;
  title: string;
  skills: string[] | null;
  certifications: string[] | null;
}

export interface JobMatchResult {
  score: number; // 0-100
  matched: string[];
  missing: string[];
  titleMatch: boolean;
}

export function resumePlainText(resume: ResumeSchema): string {
  const parts: string[] = [resume.targetJobRole ?? ''];
  for (const s of resume.sections) {
    const c = s.content;
    switch (c.kind) {
      case 'text':
        parts.push(c.value);
        break;
      case 'list':
        parts.push(c.items.join(' '));
        break;
      case 'experience':
        for (const e of c.items) parts.push(e.position, e.company, e.description, (e.achievements ?? []).join(' '));
        break;
      case 'education':
        for (const e of c.items) parts.push(e.degree, e.fieldOfStudy ?? '', e.institution, e.description ?? '');
        break;
      case 'certification':
        for (const e of c.items) parts.push(e.name, e.issuingOrganization ?? '');
        break;
      case 'link':
        break;
    }
  }
  return parts.join(' ').toLowerCase();
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

function containsKeyword(haystack: string, keyword: string): boolean {
  const k = norm(keyword);
  if (!k) return false;
  const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Word-ish boundaries so "java" doesn't match "javascript".
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(haystack);
}

export function computeJobMatch(resume: ResumeSchema, job: MatchJob): JobMatchResult {
  const text = resumePlainText(resume);
  const keywords = Array.from(
    new Map([...(job.skills ?? []), ...(job.certifications ?? [])].map((k) => [norm(k), k.trim()])).values(),
  ).filter(Boolean);

  const matched = keywords.filter((k) => containsKeyword(text, k));
  const missing = keywords.filter((k) => !containsKeyword(text, k));
  const titleWords = norm(job.title).split(' ').filter((w) => w.length > 2);
  const titleMatch = titleWords.length > 0 && titleWords.every((w) => text.includes(w));

  const score = keywords.length === 0 ? (titleMatch ? 100 : 0) : Math.round((matched.length / keywords.length) * 100);
  return { score, matched, missing, titleMatch };
}
