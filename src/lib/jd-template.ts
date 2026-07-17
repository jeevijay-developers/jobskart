// JD auto-generation. Turns structured wizard input into a rendered
// job description (markdown + HTML). Pure client-side, no AI call.
//
// New model (from Final_JD_Format_with_Sample.xlsx):
//   Title + Industry → 2-line role summary
//   Each selected Skill → one "Key Responsibility" line
// Falls back gracefully for roles not in JD_LIBRARY.

import { findRoleTemplate, type RoleTemplate } from "./jd-library";

export type JdInput = {
  title: string;
  companyName: string;
  industry?: string;
  category?: string;
  workMode?: string;
  jobType?: string;

  payType: "fixed" | "fixed_incentive" | "incentive_only";
  minSalary?: number;
  maxSalary?: number;
  avgIncentive?: number;

  experienceBucket: "any" | "fresher" | "experienced";
  minExp?: number;
  maxExp?: number;

  degree?: string;
  specialisation?: string;
  skills?: string[];
  englishLevel?: "basic" | "good" | "speaks_good";
  gender?: "any" | "male" | "female";
  shift?: string;
  workingDays?: number;
  assets?: string[];

  perks?: string[];
  joiningFeeRequired?: boolean;
  certifications?: string[];
  ageMin?: number;
  ageMax?: number;
  preferredLanguages?: string[];
  preferredIndustries?: string[];

  /** Optional employer override for the auto-summary. */
  summaryOverride?: string;
};

function fmtInr(n?: number) {
  if (!n || n <= 0) return "";
  return `₹${n.toLocaleString("en-IN")}`;
}

function salaryRange(input: JdInput): string {
  const { payType, minSalary, maxSalary, avgIncentive } = input;
  if (payType === "incentive_only") {
    return avgIncentive ? `up to ${fmtInr(avgIncentive)}/month in incentives` : "attractive incentives";
  }
  const min = fmtInr(minSalary);
  const max = fmtInr(maxSalary);
  const base = min && max ? `${min} – ${max}/month` : min || max ? `${min || max}/month` : "a competitive salary";
  if (payType === "fixed_incentive" && avgIncentive) return `${base} + incentives up to ${fmtInr(avgIncentive)}/month`;
  return base;
}

function experienceLine(input: JdInput): string {
  if (input.experienceBucket === "fresher") return "Freshers welcome";
  const min = input.minExp ?? 0;
  const max = input.maxExp;
  if (max && max > min) return `${min} – ${max} years of experience required`;
  if (min > 0) return `${min}+ years of experience required`;
  return "Any experience";
}

function englishLine(level?: JdInput["englishLevel"]): string {
  if (!level) return "";
  if (level === "basic") return "Understands basic English";
  if (level === "good") return "Understands good English";
  return "Understands & speaks good English";
}

function genderLine(g?: JdInput["gender"]): string {
  if (!g || g === "any") return "";
  return g === "male" ? "Open to male candidates" : "Open to female candidates";
}

function normSkill(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Map each selected skill to a responsibility line from the template,
 *  falling back to a generic line for unknown skills. */
function responsibilitiesFor(skills: string[], tpl: RoleTemplate | null): string[] {
  if (!skills.length) {
    if (tpl?.skillResponsibilities?.length) return tpl.skillResponsibilities;
    return tpl
      ? tpl.skills.slice(0, 5).map((s) => s.responsibility)
      : [
          "Perform day-to-day tasks assigned by the reporting manager.",
          "Coordinate with the team to meet daily/weekly targets.",
          "Maintain accurate records of your work.",
          "Follow company processes and safety guidelines.",
        ];
  }
  const index = new Map<string, string>();
  tpl?.skills.forEach((s) => index.set(normSkill(s.skill), s.responsibility));
  const mapped = skills.map((s) => {
    const hit = index.get(normSkill(s));
    if (hit) return hit;
    for (const [k, v] of index) {
      if (k.includes(normSkill(s)) || normSkill(s).includes(k)) return v;
    }
    return `Handle day-to-day tasks related to ${s}.`;
  });
  // If the template came from the JD sheet (has skillResponsibilities but no
  // real per-skill mapping), also surface a few of those authored bullets so
  // the JD reads like the sheet examples rather than repetitive "handle X".
  if (tpl?.skillResponsibilities?.length) {
    const generic = mapped.filter((m) => m.startsWith("Handle day-to-day tasks related to "));
    if (generic.length >= Math.max(1, Math.floor(mapped.length / 2))) {
      return tpl.skillResponsibilities;
    }
  }
  return mapped;
}


function summaryFor(input: JdInput, tpl: RoleTemplate | null): [string, string] {
  if (input.summaryOverride) {
    const parts = input.summaryOverride.split(/\n{1,}/).filter(Boolean);
    return [parts[0] || "", parts[1] || ""];
  }
  if (tpl) return tpl.summary;
  const generic1 = `Join ${input.companyName || "our team"} as a ${input.title || "team member"}${input.industry ? ` in ${input.industry}` : ""}.`;
  const generic2 = "You will work closely with the team to deliver on daily responsibilities and grow within the company.";
  return [generic1, generic2];
}

export function buildJd(input: JdInput): { markdown: string; html: string } {
  const tpl = findRoleTemplate(input.title, input.industry);
  const [line1, line2] = summaryFor(input, tpl);
  const responsibilities = responsibilitiesFor(input.skills ?? [], tpl);

  const compClause = `The position offers ${salaryRange(input)}${input.workMode && input.workMode !== "onsite" ? ` (${input.workMode === "remote" ? "Remote" : "Hybrid"})` : ""}.`;

  const reqBits: string[] = [];
  if (input.degree) reqBits.push(`Minimum qualification: ${input.degree}${input.specialisation ? ` (${input.specialisation})` : ""}.`);
  reqBits.push(`${experienceLine(input)}.`);
  if (input.skills?.length) reqBits.push(`Key skills: ${input.skills.slice(0, 10).join(", ")}.`);
  const eng = englishLine(input.englishLevel);
  if (eng) reqBits.push(`${eng}.`);
  const gnd = genderLine(input.gender);
  if (gnd) reqBits.push(`${gnd}.`);
  const availability: string[] = [];
  if (input.shift) availability.push(input.shift);
  if (input.workingDays) availability.push(`${input.workingDays}-day working`);
  if (input.assets?.length) availability.push(`own ${input.assets.join("/")}`);
  if (availability.length) reqBits.push(`Available for ${availability.join(", ")}.`);

  const notes: string[] = [];
  if (input.joiningFeeRequired) notes.push("Joining fee applicable");
  if (input.certifications?.length) notes.push(`Certification: ${input.certifications.join(", ")}`);
  if (input.ageMin || input.ageMax) notes.push(`${input.ageMin ?? 18} – ${input.ageMax ?? 45} years preferred`);
  if (input.preferredLanguages?.length) notes.push(`Preferred Language: ${input.preferredLanguages.join(", ")}`);
  if (input.preferredIndustries?.length) notes.push(`Preferred Industry: ${input.preferredIndustries.join(", ")}`);

  const md: string[] = [];
  md.push(line1);
  if (line2) md.push(line2);
  md.push("", compClause, "");
  md.push("**Key Responsibilities:**");
  responsibilities.forEach((r) => md.push(`- ${r}`));
  if (tpl?.fixedResponsibilities?.length) {
    tpl.fixedResponsibilities.forEach((r) => md.push(`- ${r}`));
  }
  md.push("");

  md.push("**Job Requirements:**");
  md.push(reqBits.join(" "));
  if (input.perks?.length) {
    md.push("");
    md.push("**Perks:**");
    md.push(input.perks.join(" · "));
  }
  if (notes.length) {
    md.push("");
    md.push("**Notes:**");
    notes.forEach((n) => md.push(`- ${n}`));
  }

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html: string[] = [];
  html.push(`<p>${esc(line1)}${line2 ? ` ${esc(line2)}` : ""}</p>`);
  html.push(`<p><em>${esc(compClause)}</em></p>`);
  html.push(`<h4>Key Responsibilities</h4><ul>${responsibilities.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`);
  html.push(`<h4>Job Requirements</h4><p>${esc(reqBits.join(" "))}</p>`);
  if (input.perks?.length) html.push(`<h4>Perks</h4><p>${input.perks.map(esc).join(" · ")}</p>`);
  if (notes.length) html.push(`<h4>Notes</h4><ul>${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`);

  return { markdown: md.join("\n"), html: html.join("") };
}

export function earningPotentialLabel(input: Pick<JdInput, "payType" | "minSalary" | "maxSalary" | "avgIncentive">) {
  if (input.payType !== "fixed_incentive" || !input.avgIncentive) return null;
  const hi = (input.maxSalary || input.minSalary || 0) + input.avgIncentive;
  if (!hi) return null;
  return `Earn up to ${fmtInr(hi)}/month`;
}
