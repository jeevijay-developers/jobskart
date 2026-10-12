// Plain-DOM mirror of variantResume.tsx for the live editing preview (see DomResumeTemplate.tsx for
// why the preview isn't a PDFViewer). Same tokens, same section rules, so preview == PDF.
import type { CSSProperties, ReactNode } from "react";
import { parseRichText } from "./richText";
import type {
  CertificationItem,
  EducationItem,
  ExperienceItem,
  LinkItem,
  ResumeSchema,
  ResumeSection,
} from "../schema";
import {
  buildVariantTokens,
  contactItems,
  dateRange,
  formatDate,
  groupSkills,
  languageNames,
  type VariantSpec,
  type VariantTokens,
} from "./variants";

const STACKS = {
  helvetica: "Helvetica, Arial, sans-serif",
  times: '"Times New Roman", Times, serif',
  courier: '"Courier New", Courier, monospace',
} as const;
const SERIF = STACKS.times;

const reset: CSSProperties = { margin: 0 };

function Rich({
  value,
  t,
  align,
}: {
  value: string;
  t: VariantTokens;
  align?: "left" | "center" | "right";
}) {
  return (
    <div>
      {parseRichText(value).map((block, i) => {
        const spans = block.spans.map((sp, j) => (
          <span
            key={j}
            style={sp.bold ? { fontWeight: 700 } : sp.italic ? { fontStyle: "italic" } : undefined}
          >
            {sp.text}
          </span>
        ));
        return block.bullet ? (
          <Bullet key={i} t={t}>
            {spans}
          </Bullet>
        ) : (
          <p
            key={i}
            style={{
              ...reset,
              marginBottom: 3,
              fontSize: t.fs(10),
              lineHeight: t.lh(1.45),
              textAlign: align,
            }}
          >
            {spans}
          </p>
        );
      })}
    </div>
  );
}

function Bullet({ children, t }: { children: ReactNode; t: VariantTokens }) {
  return (
    <div style={{ display: "flex", marginLeft: 2, marginBottom: 2 }}>
      <span style={{ width: 9, flexShrink: 0, fontSize: t.fs(10), lineHeight: t.lh(1.4) }}>
        {"•"}
      </span>
      <span style={{ flex: 1, fontSize: t.fs(10), lineHeight: t.lh(1.4) }}>{children}</span>
    </div>
  );
}

function Header({
  resume,
  spec,
  t,
}: {
  resume: ResumeSchema;
  spec: VariantSpec;
  t: VariantTokens;
}) {
  const items = contactItems(resume);
  const role = resume.targetJobRole?.trim();
  const name = resume.candidateName || "Resume";

  if (spec.header === "centered") {
    return (
      <div style={{ textAlign: "center", marginBottom: 10 }}>
        <p
          style={{
            ...reset,
            fontFamily: SERIF,
            fontWeight: 700,
            fontSize: t.fs(26),
            color: t.dark,
          }}
        >
          {name}
        </p>
        {role ? (
          <p style={{ ...reset, marginTop: 2, fontSize: t.fs(12), color: t.accent }}>{role}</p>
        ) : null}
        {items.length ? (
          <div
            style={{ marginTop: 6, display: "flex", flexWrap: "wrap", justifyContent: "center" }}
          >
            {items.map((c) => (
              <span key={c} style={{ fontSize: t.fs(9), color: t.body, margin: "0 7px" }}>
                {c}
              </span>
            ))}
          </div>
        ) : null}
        <div style={{ marginTop: 8, borderBottom: `1px solid ${t.accent}` }} />
      </div>
    );
  }

  if (spec.header === "split") {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 8,
        }}
      >
        <div style={{ flex: 1, paddingRight: 12 }}>
          <p style={{ ...reset, fontWeight: 700, fontSize: t.fs(24), color: t.accent }}>{name}</p>
          {role ? (
            <p style={{ ...reset, marginTop: 2, fontSize: t.fs(12), color: t.accent }}>{role}</p>
          ) : null}
        </div>
        <div style={{ textAlign: "right" }}>
          {items.map((c) => (
            <p key={c} style={{ ...reset, fontSize: t.fs(9), color: t.body, marginBottom: 2 }}>
              {c}
            </p>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        backgroundColor: t.accent,
        margin: `${-t.margins.top}px ${-t.margins.right}px 14px ${-t.margins.left}px`,
        padding: `24px ${t.margins.right}px 24px ${t.margins.left}px`,
      }}
    >
      <p style={{ ...reset, fontWeight: 700, fontSize: t.fs(24), color: t.onBand }}>{name}</p>
      {role ? (
        <p style={{ ...reset, marginTop: 2, fontSize: t.fs(12), color: t.onBand }}>{role}</p>
      ) : null}
      {items.length ? (
        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap" }}>
          {items.map((c) => (
            <span key={c} style={{ fontSize: t.fs(9), color: t.onBandSoft, marginRight: 16 }}>
              {c}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ItemHeader({
  title,
  date,
  t,
  dateColor,
}: {
  title: string;
  date?: string;
  t: VariantTokens;
  dateColor?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        marginBottom: 1,
        gap: 8,
      }}
    >
      <span style={{ flex: 1, fontWeight: 700, fontSize: t.fs(10.5), color: t.dark }}>{title}</span>
      {date ? (
        <span
          style={{
            flexShrink: 0,
            fontSize: t.fs(9.5),
            color: dateColor ?? t.muted,
            textAlign: "right",
            whiteSpace: "nowrap",
          }}
        >
          {date}
        </span>
      ) : null}
    </div>
  );
}

function CompanyLine({ parts, t }: { parts: (string | undefined)[]; t: VariantTokens }) {
  const line = parts.filter(Boolean).join("  •  ");
  return line ? (
    <p style={{ ...reset, fontSize: t.fs(9.5), color: t.muted, marginBottom: 3 }}>{line}</p>
  ) : null;
}

function blocksFor(section: ResumeSection, spec: VariantSpec, t: VariantTokens): ReactNode[] {
  const c = section.content;
  switch (c.kind) {
    case "text":
      return c.value.trim() ? [<Rich key="t" value={c.value} t={t} align={section.align} />] : [];

    case "list": {
      if (!c.items.length) return [];
      const labelCell: CSSProperties = {
        width: 78,
        flexShrink: 0,
        fontWeight: 700,
        fontSize: t.fs(9.5),
        color: t.dark,
      };
      if (section.type === "skills") {
        if (spec.skills === "chips") {
          return [
            <div key="chips" style={{ display: "flex", flexWrap: "wrap" }}>
              {c.items.map((item, i) => (
                <span
                  key={`${item}-${i}`}
                  style={{
                    backgroundColor: t.tint,
                    borderRadius: 3,
                    padding: "2.5px 6px",
                    margin: "0 5px 5px 0",
                    fontSize: t.fs(9),
                    color: t.body,
                  }}
                >
                  {item}
                </span>
              ))}
            </div>,
          ];
        }
        if (spec.skills === "grouped") {
          return groupSkills(c.items).map((g) => (
            <div key={g.label} style={{ display: "flex", marginBottom: 2 }}>
              <span style={labelCell}>{g.label}</span>
              <span style={{ flex: 1, fontSize: t.fs(9.5), lineHeight: t.lh(1.4), color: t.body }}>
                {g.items.join(", ")}
              </span>
            </div>
          ));
        }
        return [
          <p
            key="inline"
            style={{
              ...reset,
              fontSize: t.fs(10),
              lineHeight: t.lh(1.5),
              color: t.body,
              whiteSpace: "pre-wrap",
            }}
          >
            {c.items.join("   |   ")}
          </p>,
        ];
      }
      if (section.id === "languages" && spec.languagesAsInfo) {
        return [
          <div key="lang" style={{ display: "flex", marginBottom: 2 }}>
            <span style={labelCell}>Languages</span>
            <span style={{ flex: 1, fontSize: t.fs(9.5), color: t.body }}>
              {languageNames(c.items)}
            </span>
          </div>,
        ];
      }
      return [
        <p key="l" style={{ ...reset, fontSize: t.fs(10), lineHeight: t.lh(1.45), color: t.body }}>
          {c.items.join("  ·  ")}
        </p>,
      ];
    }

    case "experience": {
      const items = (c.items as ExperienceItem[]).map((exp) => (
        <div key={exp.id} style={{ position: "relative", marginBottom: 8 * t.gap }}>
          {spec.timeline ? (
            <span
              style={{
                position: "absolute",
                left: -17.5,
                top: 3,
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: t.accent,
              }}
            />
          ) : null}
          <ItemHeader
            t={t}
            title={exp.position || exp.company}
            date={dateRange(exp.startDate, exp.endDate, true)}
            dateColor={spec.timeline ? t.accent : undefined}
          />
          <CompanyLine t={t} parts={[exp.position ? exp.company : undefined, exp.location]} />
          {exp.description ? <Rich value={exp.description} t={t} /> : null}
          {exp.achievements?.map((a, i) => (
            <Bullet key={i} t={t}>
              {a}
            </Bullet>
          ))}
        </div>
      ));
      if (!spec.timeline) return items;
      return [
        <div
          key="timeline"
          style={{ marginLeft: 3, paddingLeft: 14, borderLeft: `1px solid ${t.tintLine}` }}
        >
          {items}
        </div>,
      ];
    }

    case "education":
      return (c.items as EducationItem[]).map((edu) => (
        <div key={edu.id} style={{ marginBottom: 6 * t.gap }}>
          <ItemHeader
            t={t}
            title={`${edu.degree}${edu.fieldOfStudy ? ` in ${edu.fieldOfStudy}` : ""}`}
            date={dateRange(edu.startDate, edu.endDate)}
          />
          <CompanyLine t={t} parts={[edu.institution, edu.location]} />
          {edu.description ? <Rich value={edu.description} t={t} /> : null}
        </div>
      ));

    case "certification":
      return (c.items as CertificationItem[]).map((cert) => {
        const year = formatDate(cert.issueDate);
        return (
          <Bullet key={cert.id} t={t}>
            {`${cert.name}${cert.issuingOrganization ? ` — ${cert.issuingOrganization}` : ""}${year ? ` (${year})` : ""}`}
          </Bullet>
        );
      });

    case "link":
      return (c.items as LinkItem[]).map((link) => (
        <a
          key={link.id}
          href={link.url}
          style={{
            display: "block",
            fontSize: t.fs(9.5),
            color: t.accent,
            textDecoration: "none",
            marginBottom: 2,
          }}
        >
          {link.label}: {link.url}
        </a>
      ));

    default:
      return [];
  }
}

export function DomVariantResume({ resume, spec }: { resume: ResumeSchema; spec: VariantSpec }) {
  const t = buildVariantTokens(spec, resume.layout);
  const titleBase: CSSProperties = {
    fontWeight: 700,
    fontSize: t.fs(10.5),
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: t.accent,
    marginBottom: 6,
  };
  const titleStyle: CSSProperties =
    spec.titleStyle === "bar"
      ? { ...titleBase, backgroundColor: t.tint, padding: "3px 6px" }
      : { ...titleBase, borderBottom: `1px solid ${t.accent}`, paddingBottom: 3 };

  return (
    <div style={{ fontFamily: STACKS[t.layout.fontFamily], fontSize: t.fs(10), color: t.body }}>
      <Header resume={resume} spec={spec} t={t} />
      {resume.sections.map((section) => {
        const blocks = blocksFor(section, spec, t);
        if (blocks.length === 0) return null;
        return (
          <div key={section.id} style={{ marginTop: 10 * t.gap }}>
            <div style={titleStyle}>{section.title}</div>
            {blocks}
          </div>
        );
      })}
    </div>
  );
}
