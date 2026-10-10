// Turns (template theme + layout settings) into the style objects the
// templates render with. react-pdf accepts plain objects on `style` props
// (StyleSheet.create is just an identity helper), so this runs on every
// render and the live preview reacts to layout edits instantly.
import type { ResumeLayoutSettings } from "../schema";
import type { TemplateStyles } from "./styleTypes";
import { WATERMARK_RESERVE } from "./watermark";
import { FONT_SETS, TEXT_COLORS, isDarkColor, normalizeLayout, resolveMargins, type BaseTheme } from "./theme";

const r2 = (n: number) => Math.round(n * 100) / 100;

// NOTE: react-pdf resolves a unitless `lineHeight` against the element's OWN
// fontSize (default 18pt), not the inherited page size — so every style that
// sets lineHeight must also set fontSize, or lines come out ~1.7x too loose.

export function buildResumeStyles(theme: BaseTheme, layoutInput?: ResumeLayoutSettings | null): TemplateStyles {
  const layout = normalizeLayout(layoutInput, theme);
  const fonts = FONT_SETS[layout.fontFamily];
  const margins = resolveMargins(layout);
  const k = layout.baseFontSize / 10.5; // every size scales from the base
  const fs = (n: number) => r2(n * k);
  const lh = (n: number) => r2(n * layout.lineHeightScale);
  const gap = layout.sectionSpacingScale;
  const accent = layout.accentColor;

  const bandDark = isDarkColor(accent);
  const nameColor = theme.bandHeader ? (bandDark ? "#FFFFFF" : TEXT_COLORS.dark) : TEXT_COLORS.dark;
  const contactColor = theme.bandHeader ? (bandDark ? "#E5E7EB" : "#374151") : TEXT_COLORS.contact;

  const titleBase = {
    fontSize: fs(theme.sectionTitleSize),
    fontFamily: fonts.bold,
    letterSpacing: theme.sectionTitleSpacing,
    textTransform: "uppercase" as const,
    marginBottom: 6,
  };
  const sectionTitle =
    layout.sectionHeaderStyle === "underline"
      ? { ...titleBase, color: TEXT_COLORS.dark, borderBottomWidth: 1, borderBottomColor: accent, paddingBottom: 3 }
      : layout.sectionHeaderStyle === "colored"
        ? { ...titleBase, color: accent }
        : { ...titleBase, color: TEXT_COLORS.dark };

  return {
    fonts,
    page: {
      paddingTop: margins.top,
      paddingBottom: Math.max(margins.bottom, WATERMARK_RESERVE), // keeps content clear of the watermark
      paddingLeft: margins.left,
      paddingRight: margins.right,
      fontFamily: fonts.regular,
      fontSize: fs(10.5),
      color: TEXT_COLORS.body,
    },
    // The band cancels the page padding on page 1 so it bleeds to the paper
    // edge, while pages 2+ keep the normal top margin (previously they had none).
    header: theme.bandHeader
      ? {
          backgroundColor: accent,
          marginTop: -margins.top,
          marginLeft: -margins.left,
          marginRight: -margins.right,
          paddingLeft: margins.left,
          paddingRight: margins.right,
          paddingVertical: 28,
          marginBottom: 18,
        }
      : {},
    name: { fontSize: fs(22), fontFamily: fonts.bold, color: nameColor },
    contact: { marginTop: 4, fontSize: fs(9.5), color: contactColor },
    section: { marginTop: r2(theme.sectionGap * gap) },
    sectionTitle,
    text: { marginBottom: 4, fontSize: fs(10.5), lineHeight: lh(1.45) },
    itemBlock: { marginBottom: r2(8 * gap) },
    itemHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 1 },
    itemTitle: { fontFamily: fonts.bold, fontSize: fs(10.5), flex: 1, paddingRight: 8 },
    itemDate: { fontSize: fs(9.5), color: TEXT_COLORS.muted, flexShrink: 0, textAlign: "right" },
    itemMeta: { fontSize: fs(9.5), color: TEXT_COLORS.muted, marginBottom: 3 },
    bullet: { flexDirection: "row", marginLeft: 4, marginBottom: 2 },
    bulletGlyph: { width: 10, fontSize: fs(10.5), lineHeight: lh(1.4) },
    bulletText: { flex: 1, fontSize: fs(10.5), lineHeight: lh(1.4) },
    link: { fontSize: fs(9.5), color: accent, textDecoration: "none", marginBottom: 2 },
  };
}
