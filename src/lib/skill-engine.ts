// Tiered skill recommendations for JobWizard Step 3 ("Requirements").
// Tier 1: curated per-role skills from the JD library (jd-library.ts).
// Tier 2: role-family keyword skills (options.ts ROLE_SKILL_SUGGESTIONS).
// Tier 3 (live posting trends, suggest_skills_for_roles RPC) is merged in
// by the caller — this module is pure/sync so it stays unit-testable.
import { findRoleTemplate, siblingRoles } from "./jd-library";
import { ROLE_SKILL_SUGGESTIONS, DEFAULT_SKILL_SUGGESTIONS } from "./options";

export type SkillRecommendations = { core: string[]; recommended: string[] };

function tier2Skills(title: string): string[] {
  const t = title.toLowerCase();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { keyword, skills } of ROLE_SKILL_SUGGESTIONS) {
    if (!t.includes(keyword)) continue;
    for (const s of skills) {
      const key = s.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
  }
  return out;
}

const NICE_TO_HAVE_MAX = 12;

/**
 * Role-relevant "nice-to-have" suggestions: tier-2 family skills first, then
 * skills used by sibling roles in the same industry (most-shared first).
 * Empty when the role can't be matched — never a generic global list.
 */
export function getNiceToHaveSuggestions(
  title: string,
  category?: string,
  requiredSkills: string[] = [],
  preferredSkills: string[] = [],
): string[] {
  const t = title.trim();
  if (!t) return [];

  const tpl = findRoleTemplate(t, category);
  const out: string[] = [];
  const seen = new Set<string>(
    [...requiredSkills, ...preferredSkills, ...(tpl?.skills.map((s) => s.skill) ?? [])].map((s) =>
      s.toLowerCase(),
    ),
  );
  const add = (s: string) => {
    const key = s.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };

  tier2Skills(t).forEach(add);

  if (tpl) {
    const counts = new Map<string, { skill: string; n: number }>();
    for (const r of siblingRoles(tpl)) {
      for (const { skill } of r.skills) {
        const key = skill.toLowerCase();
        const e = counts.get(key);
        if (e) e.n += 1;
        else counts.set(key, { skill, n: 1 });
      }
    }
    [...counts.values()].sort((a, b) => b.n - a.n).forEach((e) => add(e.skill));
  }

  return out.slice(0, NICE_TO_HAVE_MAX);
}

export function getRecommendedSkills(
  title: string,
  category?: string,
  currentSkills: string[] = [],
): SkillRecommendations {
  const t = title.trim();
  if (!t) return { core: [], recommended: [] };

  const exclude = new Set(currentSkills.map((s) => s.toLowerCase()));
  const tpl = findRoleTemplate(t, category);

  let core: string[] = [];
  let recommended: string[] = [];

  if (tpl) {
    // Tier 1: curated role — every listed skill is "core" (it's what the
    // curated responsibility mapping is built on); tier-2 family skills not
    // already present become "recommended" extras.
    core = tpl.skills.map((s) => s.skill);
    recommended = tier2Skills(t).filter((s) => !core.some((c) => c.toLowerCase() === s.toLowerCase()));
  } else {
    // Tier 2: no curated template — keyword family skills are "core",
    // nothing extra to add as "recommended" from a family we can't refine.
    const family = tier2Skills(t);
    if (family.length) {
      core = family;
    } else {
      // No tier match at all: generic starter list, all as recommended
      // (never assert something is core for a role we know nothing about).
      recommended = DEFAULT_SKILL_SUGGESTIONS;
    }
  }

  const dedup = (arr: string[]) => {
    const seen = new Set<string>();
    return arr.filter((s) => {
      const key = s.toLowerCase();
      if (exclude.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  return { core: dedup(core), recommended: dedup(recommended) };
}
