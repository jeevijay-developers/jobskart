// Builds the exact text that gets embedded for candidates and jobs, and the
// hash used to skip re-embedding unchanged text. Kept pure (no I/O, no aliases)
// so it is unit-testable and shared by the server functions and the backfill.

// Embedding endpoints reject or silently truncate very long inputs. Title/skills
// come first and the (long) free-text description last, so truncating the tail
// keeps the highest-signal part. Verify the provider's current input limit
// (gemini-embedding-001 documents ~2048 tokens) before raising this; Devanagari
// text uses many more tokens per character than English, hence the conservative value.
export const MAX_EMBED_CHARS = 3000;

export type CandidateEmbeddingInput = {
  headline?: string | null;
  fullName?: string | null;
  lastRole?: string | null;
  yearsExperience?: number | null;
  skills?: string[] | null;
  city?: string | null;
  bio?: string | null;
};

export type JobEmbeddingInput = {
  title?: string | null;
  category?: string | null;
  skills?: string[] | null;
  city?: string | null;
  description?: string | null;
};

function cap(text: string): string {
  if (text.length <= MAX_EMBED_CHARS) return text;
  let end = MAX_EMBED_CHARS;
  // Slicing counts UTF-16 code units; do not leave a lone high surrogate (half an emoji).
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return text.slice(0, end);
}

export function buildCandidateEmbeddingText(i: CandidateEmbeddingInput): string {
  return cap(
    [
      i.headline,
      i.lastRole ? `Most recent role: ${i.lastRole}` : null,
      i.yearsExperience != null ? `${i.yearsExperience} years of experience` : null,
      i.skills?.length ? `Skills: ${i.skills.join(", ")}` : null,
      i.city ? `Based in ${i.city}` : null,
      i.bio,
    ]
      .filter(Boolean)
      .join(". "),
  );
}

export function buildJobEmbeddingText(i: JobEmbeddingInput): string {
  return cap(
    [
      i.title,
      i.category ? `Category: ${i.category}` : null,
      i.skills?.length ? `Skills: ${i.skills.join(", ")}` : null,
      i.city ? `Location: ${i.city}` : null,
      i.description,
    ]
      .filter(Boolean)
      .join(". "),
  );
}

/** SHA-256 hex of `modelId\ntext`. Includes the model so a provider switch invalidates everything. */
export async function embeddingInputHash(modelId: string, text: string): Promise<string> {
  const data = new TextEncoder().encode(`${modelId}\n${text}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildCandidateSkillsEmbeddingText(skills: string[] | null | undefined): string {
  return cap((skills ?? []).filter(Boolean).join(", "));
}

export type CandidateRoleInput = {
  headline?: string | null;
  lastRole?: string | null;
  interestedRoles?: string[] | null;
};

export function buildCandidateRoleEmbeddingText(i: CandidateRoleInput): string {
  return cap(
    [
      i.headline ? `${i.headline}.` : null,
      i.lastRole ? `Most recent role: ${i.lastRole}.` : null,
      i.interestedRoles?.length ? `Interested in: ${i.interestedRoles.join(", ")}.` : null,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

export function buildJobSkillsEmbeddingText(skills: string[] | null | undefined): string {
  return cap((skills ?? []).filter(Boolean).join(", "));
}

export type JobRoleInput = { title?: string | null; category?: string | null };

export function buildJobRoleEmbeddingText(i: JobRoleInput): string {
  return cap(
    [i.title ? `${i.title}.` : null, i.category ? `Category: ${i.category}.` : null]
      .filter(Boolean)
      .join(" "),
  );
}
