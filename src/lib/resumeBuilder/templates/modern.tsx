// Modern — same single-column, ATS-safe structure as Classic ATS, differs
// only in a subtle accent header band and tighter type scale. Deliberately
// avoids anything an ATS parser could trip on (no multi-column layout, no
// icons replacing text, no tables).
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { ResumeSchema } from "../schema";
import { ResumeSections } from "./sections";

const ACCENT = "#1A55BD";

const styles = StyleSheet.create({
  page: { paddingBottom: 42, paddingHorizontal: 48, fontFamily: "Helvetica", fontSize: 10.5, color: "#1F2937" },
  header: { backgroundColor: ACCENT, marginHorizontal: -48, paddingHorizontal: 48, paddingVertical: 28, marginBottom: 18 },
  name: { fontSize: 22, fontFamily: "Helvetica-Bold", color: "#FFFFFF" },
  contact: { marginTop: 4, fontSize: 9.5, color: "#DBEAFE" },
  section: { marginTop: 12 },
  sectionTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: ACCENT,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  text: { marginBottom: 4, lineHeight: 1.45 },
  itemBlock: { marginBottom: 8 },
  itemTitle: { fontFamily: "Helvetica-Bold", fontSize: 10.5, marginBottom: 1 },
  itemMeta: { fontSize: 9.5, color: "#6B7280", marginBottom: 3 },
  bullet: { marginLeft: 4, marginBottom: 2, lineHeight: 1.4 },
  link: { fontSize: 9.5, color: ACCENT, textDecoration: "none", marginBottom: 2 },
});

export function ModernResume({ resume }: { resume: ResumeSchema }) {
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
      </Page>
    </Document>
  );
}
