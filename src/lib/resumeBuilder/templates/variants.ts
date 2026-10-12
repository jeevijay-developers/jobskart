// Shared design tokens + data helpers for the four designed templates (Modern, Professional,
// Practical, Technical). The PDF renderer (variantResume.tsx) and the live-preview renderer
// (DomVariantResume.tsx) both read these, so sizes, colours and content rules cannot drift apart.
// Pure and browser/server-safe. Classic ATS does not use any of this.
import type { ResumeLayoutSettings, ResumeSchema } from "../schema";
import { FONT_SETS, getTemplateTheme, isDarkColor, normalizeLayout, resolveMargins } from "./theme";

export type VariantId = "modern" | "professional" | "practical" | "technical";

export interface VariantSpec {
  id: VariantId;
  header: "band" | "centered" | "split";
  titleStyle: "rule" | "bar";
  skills: "chips" | "inline" | "grouped";
  timeline: boolean; // experience drawn as a timeline
  serifName: boolean;
  languagesAsInfo: boolean; // languages shown as an "Additional Information" row
}

export const VARIANTS: Record<VariantId, VariantSpec> = {
  modern: {
    id: "modern",
    header: "band",
    titleStyle: "rule",
    skills: "chips",
    timeline: true,
    serifName: false,
    languagesAsInfo: false,
  },
  professional: {
    id: "professional",
    header: "centered",
    titleStyle: "rule",
    skills: "inline",
    timeline: false,
    serifName: true,
    languagesAsInfo: false,
  },
  practical: {
    id: "practical",
    header: "band",
    titleStyle: "bar",
    skills: "chips",
    timeline: false,
    serifName: false,
    languagesAsInfo: true,
  },
  technical: {
    id: "technical",
    header: "split",
    titleStyle: "rule",
    skills: "grouped",
    timeline: false,
    serifName: false,
    languagesAsInfo: false,
  },
};

export function getVariant(templateId: string): VariantSpec | undefined {
  return VARIANTS[templateId as VariantId];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Blend a #RRGGBB colour toward white (t = 0 keeps it, t = 1 is white). */
export function tintColor(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(v + (255 - v) * t);
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export interface VariantTokens {
  layout: ResumeLayoutSettings;
  fonts: { regular: string; bold: string; italic: string };
  serifBold: string;
  margins: { top: number; bottom: number; left: number; right: number };
  accent: string;
  tint: string; // chips / bars
  tintLine: string; // timeline line
  onBand: string; // text colour on the accent band
  onBandSoft: string;
  dark: string;
  body: string;
  muted: string;
  fs: (n: number) => number;
  lh: (n: number) => number;
  gap: number;
}

export function buildVariantTokens(
  spec: VariantSpec,
  layoutInput?: ResumeLayoutSettings | null,
): VariantTokens {
  const layout = normalizeLayout(layoutInput, getTemplateTheme(spec.id));
  const k = layout.baseFontSize / 10.5;
  const accent = layout.accentColor;
  const darkBand = isDarkColor(accent);
  return {
    layout,
    fonts: FONT_SETS[layout.fontFamily],
    serifBold: FONT_SETS.times.bold,
    margins: resolveMargins(layout),
    accent,
    tint: tintColor(accent, 0.9),
    tintLine: tintColor(accent, 0.5),
    onBand: darkBand ? "#FFFFFF" : "#111827",
    onBandSoft: darkBand ? "#E5E7EB" : "#374151",
    dark: "#111827",
    body: "#1F2937",
    muted: "#6B7280",
    fs: (n) => r2(n * k),
    lh: (n) => r2(n * layout.lineHeightScale),
    gap: layout.sectionSpacingScale,
  };
}

export function contactItems(resume: ResumeSchema): string[] {
  return [resume.contact?.mobile, resume.contact?.email, resume.contact?.city].filter(
    (v): v is string => !!v && !!v.trim(),
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(value?: string): string {
  if (!value) return "";
  const m = value.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (m) {
    const month = Number(m[2]);
    if (month >= 1 && month <= 12) return `${MONTHS[month - 1]} ${m[1]}`;
  }
  return value;
}

export function dateRange(start?: string, end?: string, openEnded = false): string {
  const a = formatDate(start);
  const b = formatDate(end);
  if (a && b) return `${a} – ${b}`;
  if (a) return openEnded ? `${a} – Present` : a;
  return b;
}

// Technical skills are grouped by simple keyword rules; anything unrecognised is "Other", and when
// nothing is recognised at all the group is simply called "Skills" (e.g. trades, non-IT roles).
const SKILL_GROUPS: { label: string; re: RegExp }[] = [
  {
    label: "Frontend",
    re: /\b(react|next\.?js|vue|angular|svelte|html|css|sass|tailwind|bootstrap|redux|jquery|javascript|typescript|ui|ux|responsive)\b/i,
  },
  {
    label: "Backend",
    re: /\b(node\.?js|express|python|java|django|flask|spring|laravel|php|ruby|rails|go|golang|c#|\.net|rest|api|apis|graphql|microservices?)\b/i,
  },
  {
    label: "Database",
    re: /\b(sql|mysql|postgres(ql)?|mongodb|redis|firebase|supabase|oracle|sqlite|dynamodb)\b/i,
  },
  {
    label: "Tools & Others",
    re: /\b(git|github|docker|kubernetes|aws|azure|gcp|ci\/cd|jenkins|linux|nginx|figma|postman|jira|vs code)\b/i,
  },
];

export function groupSkills(items: string[]): { label: string; items: string[] }[] {
  const buckets = new Map<string, string[]>();
  for (const item of items) {
    const label = SKILL_GROUPS.find((g) => g.re.test(item))?.label ?? "Other";
    buckets.set(label, [...(buckets.get(label) ?? []), item]);
  }
  const order = [...SKILL_GROUPS.map((g) => g.label), "Other"];
  const groups = order
    .filter((l) => buckets.has(l))
    .map((l) => ({ label: l, items: buckets.get(l)! }));
  return groups.length === 1 && groups[0].label === "Other"
    ? [{ label: "Skills", items: groups[0].items }]
    : groups;
}

/** "Hindi: Fluent" entries -> a single "Languages" row for the Additional Information section. */
export function languageNames(items: string[]): string {
  return items
    .map((i) => i.split(":")[0].trim())
    .filter(Boolean)
    .join(", ");
}
