// Shared design tokens + layout-settings helpers for every resume template.
// Browser- and server-safe: no react-pdf runtime imports, so the settings UI
// and the API route can both use normalizeLayout/getDefaultLayout.
import type { ResumeLayoutSettings } from "../schema";
import type { FontSet } from "./styleTypes";

export type FontKey = ResumeLayoutSettings["fontFamily"];

// react-pdf's built-in (Standard-14) fonts — no asset files to ship.
export const FONT_SETS: Record<FontKey, FontSet> = {
  helvetica: { regular: "Helvetica", bold: "Helvetica-Bold", italic: "Helvetica-Oblique" },
  times: { regular: "Times-Roman", bold: "Times-Bold", italic: "Times-Italic" },
  courier: { regular: "Courier", bold: "Courier-Bold", italic: "Courier-Oblique" },
};

export const FONT_LABELS: Record<FontKey, string> = {
  helvetica: "Helvetica (sans-serif)",
  times: "Times (serif)",
  courier: "Courier (monospace)",
};

type Margins = { top: number; bottom: number; left: number; right: number };

export const MARGIN_PRESETS: Record<"compact" | "standard" | "spacious", Margins> = {
  compact: { top: 28, bottom: 28, left: 34, right: 34 },
  standard: { top: 42, bottom: 42, left: 48, right: 48 },
  spacious: { top: 56, bottom: 56, left: 62, right: 62 },
};

// Curated, print-safe accent colours (all dark enough for white-on-colour bands).
export const ACCENT_SWATCHES = [
  { label: "Blue", value: "#1A55BD" },
  { label: "Navy", value: "#1E3A5F" },
  { label: "Teal", value: "#0F766E" },
  { label: "Green", value: "#15803D" },
  { label: "Maroon", value: "#9F1239" },
  { label: "Charcoal", value: "#374151" },
] as const;

export const TEXT_COLORS = {
  body: "#1F2937",
  dark: "#111827",
  muted: "#6B7280",
  contact: "#4B5563",
  rule: "#D1D5DB",
} as const;

export interface BaseTheme {
  id: string;
  bandHeader: boolean; // accent-coloured header band that bleeds to the page edge
  sectionGap: number;
  sectionTitleSize: number;
  sectionTitleSpacing: number;
  defaultLayout: ResumeLayoutSettings;
}

const COMMON_DEFAULTS = {
  marginPreset: "standard",
  fontFamily: "helvetica",
  baseFontSize: 10.5,
  lineHeightScale: 1,
  sectionSpacingScale: 1,
  accentColor: "#1A55BD",
} as const;

export const CLASSIC_THEME: BaseTheme = {
  id: "classic-ats",
  bandHeader: false,
  sectionGap: 14,
  sectionTitleSize: 10.5,
  sectionTitleSpacing: 1,
  // Charcoal accent keeps the classic look neutral (dark rule under headings)
  // while still giving the accent picker a visible effect.
  defaultLayout: { ...COMMON_DEFAULTS, sectionHeaderStyle: "underline", accentColor: "#374151" },
};

export const MODERN_THEME: BaseTheme = {
  id: "modern",
  bandHeader: true,
  sectionGap: 12,
  sectionTitleSize: 10,
  sectionTitleSpacing: 1.2,
  defaultLayout: { ...COMMON_DEFAULTS, sectionHeaderStyle: "colored" },
};

const THEMES: Record<string, BaseTheme> = {
  [CLASSIC_THEME.id]: CLASSIC_THEME,
  [MODERN_THEME.id]: MODERN_THEME,
};

export function getTemplateTheme(templateId: string): BaseTheme {
  return THEMES[templateId] ?? CLASSIC_THEME;
}

export function getDefaultLayout(templateId: string): ResumeLayoutSettings {
  return { ...getTemplateTheme(templateId).defaultLayout };
}

const clamp = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Fill in defaults and clamp every value. Layout JSON can come from the
 * database or the client, so templates never trust it raw — an old version
 * with no `layout` (or a hand-edited one) always renders safely.
 */
export function normalizeLayout(input: unknown, theme: BaseTheme): ResumeLayoutSettings {
  const d = theme.defaultLayout;
  const l = (input && typeof input === "object" ? input : {}) as Partial<ResumeLayoutSettings>;
  const preset = (["compact", "standard", "spacious", "custom"] as const).includes(l.marginPreset as never)
    ? (l.marginPreset as ResumeLayoutSettings["marginPreset"])
    : d.marginPreset;
  const base = preset === "custom" ? MARGIN_PRESETS.standard : MARGIN_PRESETS[preset];
  const m = (l.margins ?? {}) as Partial<Margins>;
  return {
    marginPreset: preset,
    margins:
      preset === "custom"
        ? {
            top: clamp(m.top, 0, 120, base.top),
            bottom: clamp(m.bottom, 0, 120, base.bottom),
            left: clamp(m.left, 0, 120, base.left),
            right: clamp(m.right, 0, 120, base.right),
          }
        : undefined,
    fontFamily: l.fontFamily && l.fontFamily in FONT_SETS ? l.fontFamily : d.fontFamily,
    baseFontSize: clamp(l.baseFontSize, 8, 14, d.baseFontSize),
    lineHeightScale: clamp(l.lineHeightScale, 0.8, 2, d.lineHeightScale),
    sectionSpacingScale: clamp(l.sectionSpacingScale, 0.5, 2, d.sectionSpacingScale),
    sectionHeaderStyle: (["underline", "plain", "colored"] as const).includes(l.sectionHeaderStyle as never)
      ? (l.sectionHeaderStyle as ResumeLayoutSettings["sectionHeaderStyle"])
      : d.sectionHeaderStyle,
    accentColor: typeof l.accentColor === "string" && HEX.test(l.accentColor) ? l.accentColor : d.accentColor,
  };
}

export function resolveMargins(layout: ResumeLayoutSettings): Margins {
  if (layout.marginPreset === "custom" && layout.margins) return layout.margins;
  return MARGIN_PRESETS[layout.marginPreset === "custom" ? "standard" : layout.marginPreset];
}

/** True when white text is readable on this #RRGGBB background. */
export function isDarkColor(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.6;
}
