// Role-based PDF templates (Professional / Practical / Technical). Same single-column, ATS-safe
// structure and shared section renderer as Classic ATS / Modern - they differ by theme (type
// scale, fonts, header band, accent) and by section order/labels (see roleTemplates.ts, applied
// when the resume snapshot is built so preview, saved version and PDF all match).
import { Document, Page, Text, View } from "@react-pdf/renderer";
import type { ResumeSchema } from "../schema";
import { buildResumeStyles } from "./buildStyles";
import { ResumeSections } from "./sections";
import { ResumeWatermark } from "./watermark";
import { PRACTICAL_THEME, PROFESSIONAL_THEME, TECHNICAL_THEME, type BaseTheme } from "./theme";

function makeRoleResume(theme: BaseTheme) {
  return function RoleResume({ resume }: { resume: ResumeSchema }) {
    const styles = buildResumeStyles(theme, resume.layout);
    const contactLine = [resume.contact?.mobile, resume.contact?.email, resume.contact?.city]
      .filter(Boolean)
      .join("  ·  ");
    return (
      <Document title={resume.title}>
        <Page size="A4" style={styles.page}>
          {theme.bandHeader ? (
            <View style={styles.header}>
              <Text style={styles.name}>{resume.candidateName || "Resume"}</Text>
              {contactLine ? <Text style={styles.contact}>{contactLine}</Text> : null}
            </View>
          ) : (
            <>
              <Text style={styles.name}>{resume.candidateName || "Resume"}</Text>
              {contactLine ? <Text style={styles.contact}>{contactLine}</Text> : null}
            </>
          )}
          <ResumeSections sections={resume.sections} s={styles} />
          <ResumeWatermark />
        </Page>
      </Document>
    );
  };
}

export const ProfessionalResume = makeRoleResume(PROFESSIONAL_THEME);
export const PracticalResume = makeRoleResume(PRACTICAL_THEME);
export const TechnicalResume = makeRoleResume(TECHNICAL_THEME);
