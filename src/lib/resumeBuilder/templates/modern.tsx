// Modern — same single-column, ATS-safe structure as Classic ATS, differs
// only in an accent header band and tighter type scale. Deliberately avoids
// anything an ATS parser could trip on (no multi-column layout, no icons
// replacing text, no tables). Styles come from the shared theme + the
// resume's layout settings via buildResumeStyles.
import { Document, Page, Text, View } from "@react-pdf/renderer";
import type { ResumeSchema } from "../schema";
import { buildResumeStyles } from "./buildStyles";
import { ResumeSections } from "./sections";
import { MODERN_THEME } from "./theme";
import { ResumeWatermark } from "./watermark";

export function ModernResume({ resume }: { resume: ResumeSchema }) {
  const styles = buildResumeStyles(MODERN_THEME, resume.layout);
  const contactLine = [resume.contact?.mobile, resume.contact?.email, resume.contact?.city]
    .filter(Boolean)
    .join("  ·  ");
  return (
    <Document title={resume.title}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.name}>{resume.candidateName || "Resume"}</Text>
          {contactLine ? <Text style={styles.contact}>{contactLine}</Text> : null}
        </View>
        <ResumeSections sections={resume.sections} s={styles} />
        <ResumeWatermark />
      </Page>
    </Document>
  );
}
