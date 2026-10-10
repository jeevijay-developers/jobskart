// Plain-DOM mirror of classicAts.tsx / modern.tsx for the live editing
// preview (see LivePreview.tsx). PDFViewer's <iframe src="blob:..."> always
// reloads the iframe when content changes — native browser behavior, not
// fixable with props/CSS/state — so this renders the same resume data as an
// ordinary React tree instead while editing, and PDFViewer itself is reserved
// for Generate & Save / Download, where it's rendered once on demand.
import { buildResumeDomStyles } from "./buildDomStyles";
import { DomResumeSections } from "./DomResumeSections";
import { getTemplateTheme } from "./theme";
import {
  DIAGONAL_ANGLE,
  DIAGONAL_COLOR,
  DIAGONAL_OPACITY,
  DIAGONAL_SIZE_PT,
  WATERMARK_TEXT,
} from "./watermark";
import type { ResumeSchema } from "../schema";

// A4 width at 96dpi, matching the "pt as px" scale used by buildDomStyles —
// used as a max-width ceiling, not a fixed size: the page fills its container
// up to this width so it doesn't sit undersized with blank space on either
// side inside a wider preview frame, while never exceeding the real page's
// design proportions (font sizes/margins are tuned for this width).
// Height is NOT fixed/min-height'd to A4: with a fixed minHeight, paddingBottom
// has no visible effect whenever content is shorter than one page (the box
// stays pinned at the floor height regardless of padding), which reads as
// "Bottom margin doesn't work." Letting height follow content + padding keeps
// every BOTTOM change visible as real whitespace below the last line, for any
// resume length. The real PDF (a fixed A4 page) is unaffected — this is a
// preview-only sizing choice.
const PAGE_MAX_WIDTH = 794;

export function DomResumeTemplate({ resume }: { resume: ResumeSchema }) {
  const theme = getTemplateTheme(resume.templateId);
  const s = buildResumeDomStyles(theme, resume.layout);
  const contactLine = [resume.contact?.mobile, resume.contact?.email, resume.contact?.city]
    .filter(Boolean)
    .join("  ·  ");

  return (
    <div
      style={{
        width: "100%",
        maxWidth: PAGE_MAX_WIDTH,
        margin: "0 auto",
        ...s.page,
        position: "relative",
        containerType: "inline-size",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
          overflow: "hidden",
        }}
      >
        <span
          style={{
            fontFamily: "Helvetica, Arial, sans-serif",
            fontWeight: 700,
            fontSize: `${(DIAGONAL_SIZE_PT / 595) * 100}cqw`,
            color: DIAGONAL_COLOR,
            opacity: DIAGONAL_OPACITY,
            transform: `rotate(-${DIAGONAL_ANGLE}deg)`,
            whiteSpace: "nowrap",
            userSelect: "none",
          }}
        >
          JOBSKART
        </span>
      </div>
      {theme.bandHeader ? (
        <div style={s.header}>
          <p style={s.name}>{resume.candidateName || "Resume"}</p>
          {contactLine ? <p style={{ ...s.contact, margin: 0 }}>{contactLine}</p> : null}
        </div>
      ) : (
        <>
          <p style={s.name}>{resume.candidateName || "Resume"}</p>
          {contactLine ? <p style={{ ...s.contact, margin: 0 }}>{contactLine}</p> : null}
        </>
      )}
      <DomResumeSections sections={resume.sections} s={s} />
      <p style={{ margin: "14px 0 0", textAlign: "right", fontSize: 8.5, color: "#9CA3AF", fontFamily: "Helvetica, Arial, sans-serif" }}>
        <span style={{ fontWeight: 700, color: "#1A55BD" }}>JobsKart</span>
        {WATERMARK_TEXT.slice("JobsKart".length)}
      </p>
    </div>
  );
}
