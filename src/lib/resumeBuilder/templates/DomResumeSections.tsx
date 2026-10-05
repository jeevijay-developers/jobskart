// Plain-DOM mirror of sections.tsx + richText.tsx, used only by the live
// editing preview (see DomResumeTemplate.tsx for why). Reuses the exact same
// parsing helpers (parseRichText, formatDate, dateRange come from the
// react-pdf templates module) so content/ordering can never drift between
// the live preview and the real generated PDF — only the output tags differ
// (div/span instead of View/Text).
import type { ReactNode } from "react";
import { parseRichText } from "./richText";
import type { DomTemplateStyles } from "./buildDomStyles";
import type {
  ResumeSection,
  ExperienceItem,
  EducationItem,
  CertificationItem,
  LinkItem,
} from "../schema";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

function ItemHeader({ title, date, s }: { title: string; date?: string; s: DomTemplateStyles }) {
  return (
    <div style={s.itemHeader}>
      <span style={s.itemTitle}>{title}</span>
      {date ? <span style={s.itemDate}>{date}</span> : null}
    </div>
  );
}

function DomBulletLine({ children, s }: { children: ReactNode; s: DomTemplateStyles }) {
  return (
    <div style={s.bullet}>
      <span style={s.bulletGlyph}>{"•"}</span>
      <span style={s.bulletText}>{children}</span>
    </div>
  );
}

function DomRichText({
  value,
  s,
  align,
}: {
  value: string;
  s: DomTemplateStyles;
  align?: "left" | "center" | "right";
}) {
  const blocks = parseRichText(value);
  const textStyle = align && align !== "left" ? { ...s.text, textAlign: align } : s.text;
  return (
    <div>
      {blocks.map((block, i) => {
        const spans = block.spans.map((span, j) => (
          <span
            key={j}
            style={
              span.bold
                ? { fontWeight: 700 }
                : span.italic
                  ? { fontStyle: "italic" }
                  : undefined
            }
          >
            {span.text}
          </span>
        ));
        return block.bullet ? (
          <DomBulletLine key={i} s={s}>
            {spans}
          </DomBulletLine>
        ) : (
          <p key={i} style={{ ...textStyle, margin: 0, marginBottom: s.text.marginBottom }}>
            {spans}
          </p>
        );
      })}
    </div>
  );
}

const ITEM_KINDS = new Set(["experience", "education", "certification", "link"]);

export function DomResumeSections({ sections, s }: { sections: ResumeSection[]; s: DomTemplateStyles }) {
  return (
    <>
      {sections.map((section) => {
        const blocks = renderSectionBlocks(section, s);
        if (blocks.length === 0) return null;
        const groupsItems = ITEM_KINDS.has(section.content.kind);
        return (
          <div key={section.id} style={s.section}>
            <div style={s.sectionTitle}>{section.title}</div>
            {groupsItems ? blocks : blocks}
          </div>
        );
      })}
    </>
  );
}

function renderSectionBlocks(section: ResumeSection, s: DomTemplateStyles): ReactNode[] {
  const content = section.content;
  switch (content.kind) {
    case "text":
      return content.value.trim()
        ? [<DomRichText key="t" value={content.value} s={s} align={section.align} />]
        : [];

    case "list":
      return content.items.length
        ? [
            <p key="l" style={{ ...s.text, margin: 0 }}>
              {content.items.join("  ·  ")}
            </p>,
          ]
        : [];

    case "experience":
      return (content.items as ExperienceItem[]).map((exp) => (
        <div key={exp.id} style={s.itemBlock}>
          <ItemHeader
            s={s}
            title={`${exp.position}${exp.company ? ` — ${exp.company}` : ""}`}
            date={dateRange(exp.startDate, exp.endDate, true)}
          />
          {exp.location ? <p style={{ ...s.itemMeta, margin: 0 }}>{exp.location}</p> : null}
          {exp.description ? <DomRichText value={exp.description} s={s} /> : null}
          {exp.achievements?.map((a, i) => (
            <DomBulletLine key={i} s={s}>
              {a}
            </DomBulletLine>
          ))}
        </div>
      ));

    case "education":
      return (content.items as EducationItem[]).map((edu) => (
        <div key={edu.id} style={s.itemBlock}>
          <ItemHeader
            s={s}
            title={`${edu.degree}${edu.fieldOfStudy ? ` in ${edu.fieldOfStudy}` : ""}`}
            date={dateRange(edu.startDate, edu.endDate)}
          />
          {[edu.institution, edu.location].filter(Boolean).length ? (
            <p style={{ ...s.itemMeta, margin: 0 }}>
              {[edu.institution, edu.location].filter(Boolean).join("  ·  ")}
            </p>
          ) : null}
          {edu.description ? <DomRichText value={edu.description} s={s} /> : null}
        </div>
      ));

    case "certification":
      return (content.items as CertificationItem[]).map((cert) => {
        const meta = [cert.issuingOrganization, cert.expirationDate ? `Expires ${formatDate(cert.expirationDate)}` : null]
          .filter(Boolean)
          .join("  ·  ");
        return (
          <div key={cert.id} style={s.itemBlock}>
            <ItemHeader s={s} title={cert.name} date={formatDate(cert.issueDate)} />
            {meta ? <p style={{ ...s.itemMeta, margin: 0 }}>{meta}</p> : null}
          </div>
        );
      });

    case "link":
      return (content.items as LinkItem[]).map((link) => (
        <a key={link.id} href={link.url} style={s.link}>
          {link.label}: {link.url}
        </a>
      ));

    default:
      return [];
  }
}
