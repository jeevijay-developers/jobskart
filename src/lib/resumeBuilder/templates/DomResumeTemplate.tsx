// Plain-DOM mirror of classicAts.tsx / modern.tsx for the live editing
// preview (see LivePreview.tsx). PDFViewer's <iframe src="blob:..."> always
// reloads the iframe when content changes — native browser behavior, not
// fixable with props/CSS/state — so this renders the same resume data as an
// ordinary React tree instead while editing, and PDFViewer itself is reserved
// for Generate & Save / Download, where it's rendered once on demand.
import { buildResumeDomStyles } from "./buildDomStyles";
import { DomResumeSections } from "./DomResumeSections";
import { CLASSIC_THEME, MODERN_THEME } from "./theme";
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

function getDomTheme(templateId: string) {
  return templateId === "modern" ? MODERN_THEME : CLASSIC_THEME;
}

export function DomResumeTemplate({ resume }: { resume: ResumeSchema }) {
  const theme = getDomTheme(resume.templateId);
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
      }}
    >
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
    </div>
  );
}
