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
  city?: string;
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

function withArticle(title: string) {
  return /^[aeiou]/i.test(title.trim()) ? `an ${title}` : `a ${title}`;
}

/**
 * Single canonical JD, following JD_Auto_Generation_Template.docx:
 * Opening → Key Responsibilities → Job Requirements → Perks → Notes.
 * Perks and Notes lines only appear when data exists.
 */
export function buildJd(input: JdInput): { markdown: string; html: string } {
  const tpl = findRoleTemplate(input.title, input.industry);
  const [line1, line2] = summaryFor(input, tpl);
  const responsibilities = responsibilitiesFor(input.skills ?? [], tpl);
  const allResp = [...responsibilities, ...(tpl?.fixedResponsibilities ?? [])];

  const opening = [
    `We are looking for ${withArticle(input.title || "team member")} to join ${input.companyName || "our team"}${input.industry ? `, in ${input.industry}` : ""}.`,
    line1,
    line2,
    `The position offers ${salaryRange(input)} and opportunities for growth.`,
  ]
    .filter(Boolean)
    .join(" ");

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
  if (input.certifications?.length) notes.push(`Certification: ${input.certifications.join(", ")} required`);
  if (input.ageMin || input.ageMax) notes.push(`${input.ageMin ?? 18} – ${input.ageMax ?? 45} years preferred`);
  if (input.preferredLanguages?.length) notes.push(`Preferred Language: ${input.preferredLanguages.join(", ")}`);
  if (input.preferredIndustries?.length) notes.push(`Preferred Industry: ${input.preferredIndustries.join(", ")}`);
  if (input.workMode === "remote" || input.workMode === "hybrid") {
    notes.push(`Work Mode: ${input.workMode === "remote" ? "Remote" : "Hybrid"}`);
  }

  const md: string[] = [opening, "", "**Key Responsibilities:**"];
  allResp.forEach((r) => md.push(`- ${r}`));
  md.push("", "**Job Requirements:**", reqBits.join(" "));
  if (input.perks?.length) md.push("", "**Perks:**", input.perks.join(" · "));
  if (notes.length) {
    md.push("", "**Notes:**");
    notes.forEach((n) => md.push(`- ${n}`));
  }

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = [
    `<p>${esc(opening)}</p>`,
    `<h4>Key Responsibilities</h4><ul>${allResp.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`,
    `<h4>Job Requirements</h4><p>${esc(reqBits.join(" "))}</p>`,
  ];
  if (input.perks?.length) html.push(`<h4>Perks</h4><p>${input.perks.map(esc).join(" · ")}</p>`);
  if (notes.length) html.push(`<h4>Notes</h4><ul>${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`);

  return { markdown: md.join("\n"), html: html.join("") };
}

/**
 * Renders the markdown subset buildJd() emits (**bold**, "- " bullets, one paragraph
 * per line) as the same kind of HTML, so edited/polished text can refresh the preview,
 * PDF and published description_html instead of leaving the old template HTML behind.
 */
export function markdownToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) => esc(s).replace(/[*][*]([^*]+)[*][*]/g, "<strong>$1</strong>");
  const out: string[] = [];
  let items: string[] = [];
  const flush = () => {
    if (items.length) out.push(`<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`);
    items = [];
  };
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      items.push(inline(line.slice(2)));
    } else {
      flush();
      // A line that is only "**Heading:**" is a section heading, as buildJd's HTML.
      const heading = line.match(/^\*\*([^*]+?):?\*\*$/);
      out.push(heading ? `<h4>${esc(heading[1])}</h4>` : `<p>${inline(line)}</p>`);
    }
  }
  flush();
  return out.join("");
}

/**
 * Inverse of markdownToHtml for HTML typed into a contentEditable block (which may
 * contain <div>/<br>/<b>/<i>). Anything outside that subset is reduced to its text,
 * so the result is safe to re-render with markdownToHtml. Browser-only (DOMParser).
 */
export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const lines: string[] = [];

  const inline = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\s+/g, " ");
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === "br") return "\n";
    const inner = Array.from(el.childNodes).map(inline).join("");
    if ((tag === "strong" || tag === "b") && inner.trim()) return `**${inner.trim()}**`;
    return inner;
  };
  const pushText = (s: string) => {
    for (const part of s.split("\n")) {
      const t = part.trim();
      if (t) lines.push(t);
    }
  };
  const block = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) return pushText(inline(node));
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === "ul" || tag === "ol") {
      lines.push("");
      el.querySelectorAll(":scope > li").forEach((li) => {
        const t = inline(li).replace(/\s+/g, " ").trim();
        if (t) lines.push(`- ${t}`);
      });
      lines.push("");
    } else if (/^h[1-6]$/.test(tag)) {
      const t = inline(el).replace(/\*\*/g, "").replace(/\s+/g, " ").trim().replace(/:$/, "");
      if (t) lines.push("", `**${t}:**`);
    } else if (tag === "p" || tag === "div") {
      if (Array.from(el.children).some((c) => /^(ul|ol|p|div|h[1-6])$/i.test(c.tagName))) {
        el.childNodes.forEach(block);
      } else {
        lines.push("");
        pushText(inline(el));
      }
    } else {
      pushText(inline(el));
    }
  };
  doc.body.childNodes.forEach(block);

  return lines
    .join("\n")
    .replace(/(^\*\*[^*\n]+:\*\*)\n\n/gm, "$1\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function earningPotentialLabel(input: Pick<JdInput, "payType" | "minSalary" | "maxSalary" | "avgIncentive">) {
  if (input.payType !== "fixed_incentive" || !input.avgIncentive) return null;
  const hi = (input.maxSalary || input.minSalary || 0) + input.avgIncentive;
  if (!hi) return null;
  return `Earn up to ${fmtInr(hi)}/month`;
}
