// DOM/CSS mirror of buildStyles.ts for the live-editing preview (see
// DomResumeTemplate.tsx). PDFViewer's <iframe src="blob:..."> is reassigned on
// every content change, which always forces a native iframe reload — flicker
// that's inherent to the browser, not fixable with React state/CSS. While
// editing, the preview renders this plain-DOM mirror instead (ordinary React
// re-renders, zero iframe involved); PDFViewer itself is only mounted for
// Generate & Save / Download, where a brief render is expected and acceptable.
// Keep this visually identical to buildStyles.ts — same scale math, same
// theme tokens — so the DOM preview never drifts from the real PDF output.
import type { CSSProperties } from "react";
import type { ResumeLayoutSettings } from "../schema";
import { FONT_SETS, TEXT_COLORS, isDarkColor, normalizeLayout, resolveMargins, type BaseTheme } from "./theme";

const r2 = (n: number) => Math.round(n * 100) / 100;
// react-pdf pt and CSS px are both 1/72in-based here (A4 page, no zoom), so we
// can reuse buildStyles.ts's pt values directly as px for an on-screen mirror.
const pt = (n: number) => `${r2(n)}px`;

const FONT_STACKS: Record<ResumeLayoutSettings["fontFamily"], string> = {
  helvetica: 'Helvetica, Arial, sans-serif',
  times: '"Times New Roman", Times, serif',
  courier: '"Courier New", Courier, monospace',
};

export interface DomTemplateStyles {
  page: CSSProperties;
  header: CSSProperties;
  name: CSSProperties;
  contact: CSSProperties;
  section: CSSProperties;
  sectionTitle: CSSProperties;
  text: CSSProperties;
  itemBlock: CSSProperties;
  itemHeader: CSSProperties;
  itemTitle: CSSProperties;
  itemDate: CSSProperties;
  itemMeta: CSSProperties;
  bullet: CSSProperties;
  bulletGlyph: CSSProperties;
  bulletText: CSSProperties;
  link: CSSProperties;
  boldFontFamily: string;
  italicFontFamily: string;
}

export function buildResumeDomStyles(
  theme: BaseTheme,
  layoutInput?: ResumeLayoutSettings | null,
): DomTemplateStyles {
  const layout = normalizeLayout(layoutInput, theme);
  const fontStack = FONT_STACKS[layout.fontFamily];
  const margins = resolveMargins(layout);
  const k = layout.baseFontSize / 10.5;
  const fs = (n: number) => r2(n * k);
  // CSS line-height, like react-pdf's, is unitless-relative-to-own-font-size
  // when given a bare number — no px conversion needed (unlike buildStyles.ts's
  // `fs(n)`, which only exists because react-pdf doesn't support unitless here).
  const lh = (n: number) => r2(n * layout.lineHeightScale);
  const gap = layout.sectionSpacingScale;
  const accent = layout.accentColor;

  const bandDark = isDarkColor(accent);
  const nameColor = theme.bandHeader ? (bandDark ? "#FFFFFF" : TEXT_COLORS.dark) : TEXT_COLORS.dark;
  const contactColor = theme.bandHeader ? (bandDark ? "#E5E7EB" : "#374151") : TEXT_COLORS.contact;

  const titleBase: CSSProperties = {
    fontSize: pt(fs(theme.sectionTitleSize)),
    fontWeight: 700,
    letterSpacing: theme.sectionTitleSpacing,
    textTransform: "uppercase",
    marginBottom: 6,
  };
  const sectionTitle: CSSProperties =
    layout.sectionHeaderStyle === "underline"
      ? { ...titleBase, color: TEXT_COLORS.dark, borderBottom: `1px solid ${accent}`, paddingBottom: 3 }
      : layout.sectionHeaderStyle === "colored"
        ? { ...titleBase, color: accent }
        : { ...titleBase, color: TEXT_COLORS.dark };

  return {
    page: {
      paddingTop: pt(margins.top),
      paddingBottom: pt(margins.bottom),
      paddingLeft: pt(margins.left),
      paddingRight: pt(margins.right),
      fontFamily: fontStack,
      fontSize: pt(fs(10.5)),
      color: TEXT_COLORS.body,
      backgroundColor: "#ffffff",
      boxSizing: "border-box",
    },
    // The real PDF's header bleeds fully to the paper edge (marginTop/Left/Right
    // === -margins.*, exactly cancelling the page padding) — correct there since
    // a PDF page has no other way to show margin changes except content position.
    // In this on-screen preview, cancelling the margin (fully, or even
    // partially) makes the band visually under-respond to TOP/LEFT/RIGHT
    // relative to the body text below it, which reads as "margin doesn't
    // work" even though the numbers are correct. So the preview's band is a
    // plain block sized by the page's own padding box, same as the body —
    // every margin moves it by the full amount, unambiguously. It no longer
    // bleeds to the physical page edge here (a one-time visual difference
    // from the previous preview default), but the real generated PDF
    // (buildStyles.ts, untouched) still bleeds edge-to-edge as designed.
    header: theme.bandHeader
      ? {
          backgroundColor: accent,
          paddingTop: 28,
          paddingBottom: 28,
          paddingLeft: 16,
          paddingRight: 16,
          marginBottom: 18,
        }
      : {},
    name: { fontSize: pt(fs(22)), fontWeight: 700, color: nameColor, margin: 0 },
    contact: { marginTop: 4, fontSize: pt(fs(9.5)), color: contactColor },
    section: { marginTop: pt(r2(theme.sectionGap * gap)) },
    sectionTitle,
    text: { marginBottom: 4, fontSize: pt(fs(10.5)), lineHeight: lh(1.45) },
    itemBlock: { marginBottom: pt(r2(8 * gap)) },
    itemHeader: {
      display: "flex",
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: 1,
      gap: 8,
    },
    itemTitle: { fontWeight: 700, fontSize: pt(fs(10.5)), flex: 1 },
    itemDate: { fontSize: pt(fs(9.5)), color: TEXT_COLORS.muted, flexShrink: 0, textAlign: "right", whiteSpace: "nowrap" },
    itemMeta: { fontSize: pt(fs(9.5)), color: TEXT_COLORS.muted, marginBottom: 3 },
    bullet: { display: "flex", flexDirection: "row", marginLeft: 4, marginBottom: 2 },
    bulletGlyph: { width: 10, fontSize: pt(fs(10.5)), lineHeight: lh(1.4), flexShrink: 0 },
    bulletText: { flex: 1, fontSize: pt(fs(10.5)), lineHeight: lh(1.4) },
    link: { fontSize: pt(fs(9.5)), color: accent, textDecoration: "none", marginBottom: 2, display: "block" },
    boldFontFamily: fontStack,
    italicFontFamily: fontStack,
  };
}
