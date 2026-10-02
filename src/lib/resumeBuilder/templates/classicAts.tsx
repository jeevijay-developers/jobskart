// Classic ATS — single column, no tables/graphics, standard section headers.
// Styles come from the shared theme + the resume's layout settings
// (margins, font, spacing, header style, accent) via buildResumeStyles.
import { Document, Page, Text } from "@react-pdf/renderer";
import type { ResumeSchema } from "../schema";
import { buildResumeStyles } from "./buildStyles";
import { ResumeSections } from "./sections";
import { CLASSIC_THEME } from "./theme";

export function ClassicAtsResume({ resume }: { resume: ResumeSchema }) {
  const styles = buildResumeStyles(CLASSIC_THEME, resume.layout);
  const contactLine = [resume.contact?.mobile, resume.contact?.email, resume.contact?.city]
    .filter(Boolean)
    .join("  ·  ");
  return (
    <Document title={resume.title}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.name}>{resume.candidateName || "Resume"}</Text>
        {contactLine ? <Text style={styles.contact}>{contactLine}</Text> : null}
        <ResumeSections sections={resume.sections} s={styles} />
      </Page>
    </Document>
  );
}
