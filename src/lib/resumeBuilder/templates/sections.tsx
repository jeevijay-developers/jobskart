// Shared section-rendering logic reused by every resume template (react-pdf).
// One implementation per ResumeSection type, parameterized by each
// template's own StyleSheet — this is what keeps every template ATS-safe
// (single column, real text nodes, no tables/images standing in for text)
// without duplicating the per-section-type switch in every template file.
import { Text, View, Link } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
import { RichText } from "./richText";
import type {
  ResumeSection,
  ExperienceItem,
  EducationItem,
  CertificationItem,
  LinkItem,
} from "../schema";

export type SectionStyles = {
  section: Style;
  sectionTitle: Style;
  text: Style;
  itemBlock: Style;
  itemTitle: Style;
  itemMeta: Style;
  bullet: Style;
  link: Style;
};

function dateRange(start?: string, end?: string): string {
  if (!start && !end) return "";
  return `${start ?? ""} – ${end ?? "Present"}`;
}

export function ResumeSections({ sections, s }: { sections: ResumeSection[]; s: SectionStyles }) {
  return (
    <>
      {sections.map((section) => (
        <View key={section.id} style={s.section}>
          <Text style={s.sectionTitle} minPresenceAhead={48}>
            {section.title}
          </Text>
          {renderSectionContent(section, s)}
        </View>
      ))}
    </>
  );
}

function renderSectionContent(section: ResumeSection, s: SectionStyles) {
  const content = section.content;
  switch (content.kind) {
    case "text":
      return <RichText value={content.value} style={s.text} bulletStyle={s.bullet} />;

    case "list":
      return <Text style={s.text}>{content.items.join("  ·  ")}</Text>;

    case "experience":
      return (content.items as ExperienceItem[]).map((exp) => (
        <View key={exp.id} style={s.itemBlock} wrap={false}>
          <Text style={s.itemTitle}>
            {exp.position}
            {exp.company ? ` — ${exp.company}` : ""}
          </Text>
          <Text style={s.itemMeta}>
            {[dateRange(exp.startDate, exp.endDate), exp.location].filter(Boolean).join("  ·  ")}
          </Text>
          {exp.description ? <RichText value={exp.description} style={s.text} bulletStyle={s.bullet} /> : null}
          {exp.achievements?.map((a, i) => (
            <Text key={i} style={s.bullet}>
              {"•  "}
              {a}
            </Text>
          ))}
        </View>
      ));

    case "education":
      return (content.items as EducationItem[]).map((edu) => (
        <View key={edu.id} style={s.itemBlock} wrap={false}>
          <Text style={s.itemTitle}>
            {edu.degree}
            {edu.fieldOfStudy ? ` in ${edu.fieldOfStudy}` : ""}
          </Text>
          <Text style={s.itemMeta}>
            {[edu.institution, dateRange(edu.startDate, edu.endDate), edu.location]
              .filter(Boolean)
              .join("  ·  ")}
          </Text>
          {edu.description ? <RichText value={edu.description} style={s.text} bulletStyle={s.bullet} /> : null}
        </View>
      ));

    case "certification":
      return (content.items as CertificationItem[]).map((cert) => (
        <View key={cert.id} style={s.itemBlock} wrap={false}>
          <Text style={s.itemTitle}>{cert.name}</Text>
          <Text style={s.itemMeta}>
            {[
              cert.issuingOrganization,
              cert.issueDate ? `Issued ${cert.issueDate}` : null,
              cert.expirationDate ? `Expires ${cert.expirationDate}` : null,
            ]
              .filter(Boolean)
              .join("  ·  ")}
          </Text>
        </View>
      ));

    case "link":
      return (content.items as LinkItem[]).map((link) => (
        <Link key={link.id} src={link.url} style={s.link}>
          {link.label}: {link.url}
        </Link>
      ));

    default:
      return null;
  }
}
