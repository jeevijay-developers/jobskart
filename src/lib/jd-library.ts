// JD library — per-role templates from the client's "Data JD" sheet
// (src/lib/jd-library-data.json, generated from Data JD.xlsx). Each role has a
// 2-line summary, skill → responsibility pairs (ordered by priority) and fixed
// responsibilities. The wizard picks the closest role and renders the
// responsibilities for the skills the employer selected.

import jdRoles from "./jd-library-data.json";

export type SkillResponsibility = { skill: string; responsibility: string };

export type RoleTemplate = {
  title: string;
  industry: string;
  summary: [string, string];
  /** Skill → responsibility pairs, in priority order. */
  skills: SkillResponsibility[];
  /** Responsibility line per skill, in the same order as `skills`. */
  skillResponsibilities?: string[];
  /** Fixed responsibilities appended after skill-based ones. */
  fixedResponsibilities?: string[];
  /** Flat skill list, same order as `skills`. */
  skillList?: string[];
};

type DataRole = {
  role_id: string;
  title: string;
  industry: string;
  department: string;
  summary: string;
  skills: { skill: string; priority: number | null; jd_line: string | null }[];
  fixed_responsibilities: { id: string; text: string }[];
};

/** Splits the sheet's "Line 1: … Line 2: …" summary into its two sentences. */
function splitSummary(raw: string): [string, string] {
  const text = raw.replace(/\s+/g, " ").trim();
  const match = text.match(/^(?:Line 1:\s*)?(.*?)\s*Line 2:\s*(.*)$/i);
  if (match) return [match[1].trim(), match[2].trim()];
  return [text, ""];
}

const JD_ROLES: RoleTemplate[] = (jdRoles as DataRole[]).map((r) => {
  const ordered = [...r.skills].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  return {
    title: r.title,
    industry: r.industry,
    summary: splitSummary(r.summary),
    skills: ordered.map((s) => ({
      skill: s.skill,
      responsibility: s.jd_line || `Handle day-to-day tasks related to ${s.skill}.`,
    })),
    skillResponsibilities: ordered.map((s) => s.jd_line || "").filter(Boolean),
    fixedResponsibilities: r.fixed_responsibilities.map((f) => f.text),
    skillList: ordered.map((s) => s.skill),
  };
});

export const JD_LIBRARY: RoleTemplate[] = JD_ROLES;

function norm(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Best-effort role match by title, then industry, then null. */
export function findRoleTemplate(title?: string, industry?: string): RoleTemplate | null {
  const t = norm(title || "");
  const i = norm(industry || "");
  if (t) {
    const exact = JD_LIBRARY.find((r) => norm(r.title) === t);
    if (exact) return exact;
    // Prefer the longest (most specific) title overlap, not the first one found.
    let best: RoleTemplate | null = null;
    let bestLen = 0;
    for (const r of JD_LIBRARY) {
      const rt = norm(r.title);
      if (!rt) continue;
      if ((t.includes(rt) || rt.includes(t)) && rt.length > bestLen) {
        best = r;
        bestLen = rt.length;
      }
    }
    if (best) return best;
    // A title was typed but matches no role: don't guess from the industry.
    return null;
  }
  if (i) {
    const byInd = JD_LIBRARY.find((r) => norm(r.industry) === i);
    if (byInd) return byInd;
  }
  return null;
}

/** Other roles in the same industry as `tpl` (excluding `tpl` itself). */
export function siblingRoles(tpl: RoleTemplate): RoleTemplate[] {
  return JD_LIBRARY.filter((r) => r !== tpl && r.industry === tpl.industry);
}

/** Suggested skills for a role — used to power a one-tap chip strip. */
export function suggestedSkillsFor(title?: string, industry?: string): string[] {
  const tpl = findRoleTemplate(title, industry);
  return tpl ? tpl.skills.map((s) => s.skill) : [];
}
