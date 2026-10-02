// Shared section-rendering logic reused by every resume template (react-pdf).
// One implementation per ResumeSection type, parameterized by the style
// objects each template builds (see buildStyles.ts) — this is what keeps every
// template ATS-safe (single column, real text nodes, no tables/images
// standing in for text) without duplicating the per-section-type switch.
import type { ReactNode } from "react";
import { Text, View, Link } from "@react-pdf/renderer";
import { BulletLine, RichText } from "./richText";
import type { SectionStyles } from "./styleTypes";
import type {
  ResumeSection,
  ExperienceItem,
  EducationItem,
  CertificationItem,
  LinkItem,
} from "../schema";

export type { SectionStyles } from "./styleTypes";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Profile dates arrive as "2020-01-15" / "2020-01"; show "Jan 2020".
function formatDate(value?: string): string {
  if (!value) return "";
  const m = value.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (m) {
    const month = Number(m[2]);
    if (month >= 1 && month <= 12) return `${MONTHS[month - 1]} ${m[1]}`;
  }
  return value;
}

function dateRange(start?: string, end?: string, openEnded = false): string {
  const a = formatDate(start);
  const b = formatDate(end);
  if (a && b) return `${a} – ${b}`;
  if (a) return openEnded ? `${a} – Present` : a;
  return b;
}

function ItemHeader({ title, date, s }: { title: string; date?: string; s: SectionStyles }) {
  return (
    <View style={s.itemHeader}>
      <Text style={s.itemTitle}>{title}</Text>
      {date ? <Text style={s.itemDate}>{date}</Text> : null}
    </View>
  );
}

const ITEM_KINDS = new Set(["experience", "education", "certification", "link"]);

export function ResumeSections({ sections, s }: { sections: ResumeSection[]; s: SectionStyles }) {
  return (
    <>
      {sections.map((section) => {
        const blocks = renderSectionBlocks(section, s);
        if (blocks.length === 0) return null;
        const groupsItems = ITEM_KINDS.has(section.content.kind);
        return (
          <View key={section.id} style={s.section}>
            {groupsItems ? (
              <>
                {/* Title travels with the first item, so a heading is never
                    stranded alone at the bottom of a page. */}
                <View wrap={false}>
                  <Text style={s.sectionTitle}>{section.title}</Text>
                  {blocks[0]}
                </View>
                {blocks.slice(1)}
              </>
            ) : (
              <>
                <Text style={s.sectionTitle} minPresenceAhead={48}>
                  {section.title}
                </Text>
                {blocks}
              </>
            )}
          </View>
        );
      })}
    </>
  );
}

function renderSectionBlocks(section: ResumeSection, s: SectionStyles): ReactNode[] {
  const content = section.content;
  switch (content.kind) {
    case "text":
      return content.value.trim()
        ? [<RichText key="t" value={content.value} s={s} align={section.align} />]
        : [];

    case "list":
      return content.items.length ? [<Text key="l" style={s.text}>{content.items.join("  ·  ")}</Text>] : [];

    case "experience":
      return (content.items as ExperienceItem[]).map((exp) => (
        <View key={exp.id} style={s.itemBlock} wrap={false}>
          <ItemHeader
            s={s}
            title={`${exp.position}${exp.company ? ` — ${exp.company}` : ""}`}
            date={dateRange(exp.startDate, exp.endDate, true)}
          />
          {exp.location ? <Text style={s.itemMeta}>{exp.location}</Text> : null}
          {exp.description ? <RichText value={exp.description} s={s} /> : null}
          {exp.achievements?.map((a, i) => (
            <BulletLine key={i} s={s}>{a}</BulletLine>
          ))}
        </View>
      ));

    case "education":
      return (content.items as EducationItem[]).map((edu) => (
        <View key={edu.id} style={s.itemBlock} wrap={false}>
          <ItemHeader
            s={s}
            title={`${edu.degree}${edu.fieldOfStudy ? ` in ${edu.fieldOfStudy}` : ""}`}
            date={dateRange(edu.startDate, edu.endDate)}
          />
          {[edu.institution, edu.location].filter(Boolean).length ? (
            <Text style={s.itemMeta}>{[edu.institution, edu.location].filter(Boolean).join("  ·  ")}</Text>
          ) : null}
          {edu.description ? <RichText value={edu.description} s={s} /> : null}
        </View>
      ));

    case "certification":
      return (content.items as CertificationItem[]).map((cert) => {
        const meta = [cert.issuingOrganization, cert.expirationDate ? `Expires ${formatDate(cert.expirationDate)}` : null]
          .filter(Boolean)
          .join("  ·  ");
        return (
          <View key={cert.id} style={s.itemBlock} wrap={false}>
            <ItemHeader s={s} title={cert.name} date={formatDate(cert.issueDate)} />
            {meta ? <Text style={s.itemMeta}>{meta}</Text> : null}
          </View>
        );
      });

    case "link":
      return (content.items as LinkItem[]).map((link) => (
        <Link key={link.id} src={link.url} style={s.link}>
          {link.label}: {link.url}
        </Link>
      ));

    default:
      return [];
  }
}
