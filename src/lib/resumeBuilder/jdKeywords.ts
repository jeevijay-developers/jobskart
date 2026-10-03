// Pull known skills out of pasted job-description text. Deterministic (dictionary
// + synonyms, no AI call), so it works offline and never makes things up. The
// candidate reviews the list before it is used for matching.
import { containsKeyword } from "./jobMatch";
import { SKILL_DICTIONARY } from "./skillDictionary";
import { termsFor } from "./skillSynonyms";

export function extractSkills(jobDescription: string): string[] {
  const text = jobDescription.toLowerCase();
  return SKILL_DICTIONARY.filter((skill) =>
    termsFor(skill.toLowerCase()).some((term) => containsKeyword(text, term)),
  );
}
