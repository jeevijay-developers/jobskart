// Classic ATS — single column, no tables/graphics, standard section headers.
// Built-in Helvetica (always available in react-pdf, no font asset to manage
// or fail to load) keeps this reliable; a custom embedded font is a later
// polish item, not required for ATS-safety or correctness.
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { ResumeSchema } from "../schema";
import { ResumeSections } from "./sections";

const styles = StyleSheet.create({
  page: { paddingTop: 42, paddingBottom: 42, paddingHorizontal: 48, fontFamily: "Helvetica", fontSize: 10.5, color: "#1F2937" },
  name: { fontSize: 22, fontFamily: "Helvetica-Bold", color: "#111827" },
  contact: { marginTop: 4, fontSize: 9.5, color: "#4B5563" },
  section: { marginTop: 14 },
  sectionTitle: {
    fontSize: 10.5,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
    letterSpacing: 1,
    textTransform: "uppercase",
    borderBottomWidth: 1,
    borderBottomColor: "#D1D5DB",
    paddingBottom: 3,
    marginBottom: 6,
  },
  text: { marginBottom: 4, lineHeight: 1.45 },
  itemBlock: { marginBottom: 8 },
  itemTitle: { fontFamily: "Helvetica-Bold", fontSize: 10.5, marginBottom: 1 },
  itemMeta: { fontSize: 9.5, color: "#6B7280", marginBottom: 3 },
  bullet: { marginLeft: 4, marginBottom: 2, lineHeight: 1.4 },
  link: { fontSize: 9.5, color: "#1A55BD", textDecoration: "none", marginBottom: 2 },
});

export function ClassicAtsResume({ resume }: { resume: ResumeSchema }) {
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
