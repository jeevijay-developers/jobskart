// PDF renderer for the designed templates (Modern, Professional, Practical, Technical). Real text
// nodes, single column; DomVariantResume.tsx mirrors it for the live preview and both read the same
// tokens (variants.ts). Classic ATS keeps its own renderer and is not touched.
import type { ReactNode } from "react";
import { Document, Link, Page, Text, View } from "@react-pdf/renderer";
import type {
  CertificationItem,
  EducationItem,
  ExperienceItem,
  LinkItem,
  ResumeSchema,
  ResumeSection,
} from "../schema";
import { BulletLine, RichText } from "./richText";
import type { RichTextStyles } from "./styleTypes";
import {
  buildVariantTokens,
  contactItems,
  dateRange,
  formatDate,
  groupSkills,
  languageNames,
  VARIANTS,
  type VariantSpec,
  type VariantTokens,
} from "./variants";
import { ResumeWatermark, WATERMARK_RESERVE } from "./watermark";

function richStyles(t: VariantTokens): RichTextStyles {
  return {
    fonts: t.fonts,
    text: { marginBottom: 3, fontSize: t.fs(10), lineHeight: t.lh(1.45) },
    bullet: { flexDirection: "row", marginLeft: 2, marginBottom: 2 },
    bulletGlyph: { width: 9, fontSize: t.fs(10), lineHeight: t.lh(1.4) },
    bulletText: { flex: 1, fontSize: t.fs(10), lineHeight: t.lh(1.4) },
  };
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
      <View style={{ alignItems: "center", marginBottom: 10 }}>
        <Text style={{ fontFamily: t.serifBold, fontSize: t.fs(26), color: t.dark }}>{name}</Text>
        {role ? (
          <Text style={{ marginTop: 2, fontSize: t.fs(12), color: t.accent }}>{role}</Text>
        ) : null}
        {items.length ? (
          <View
            style={{
              marginTop: 6,
              flexDirection: "row",
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
            {items.map((c) => (
              <Text key={c} style={{ fontSize: t.fs(9), color: t.body, marginHorizontal: 7 }}>
                {c}
              </Text>
            ))}
          </View>
        ) : null}
        <View
          style={{
            alignSelf: "stretch",
            marginTop: 8,
            borderBottomWidth: 1,
            borderBottomColor: t.accent,
          }}
        />
      </View>
    );
  }

  if (spec.header === "split") {
    return (
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 8,
        }}
      >
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={{ fontFamily: t.fonts.bold, fontSize: t.fs(24), color: t.accent }}>
            {name}
          </Text>
          {role ? (
            <Text style={{ marginTop: 2, fontSize: t.fs(12), color: t.accent }}>{role}</Text>
          ) : null}
        </View>
        <View style={{ alignItems: "flex-end" }}>
          {items.map((c) => (
            <Text key={c} style={{ fontSize: t.fs(9), color: t.body, marginBottom: 2 }}>
              {c}
            </Text>
          ))}
        </View>
      </View>
    );
  }

  // band: accent block bleeding to the paper edges on the first page
  return (
    <View
      style={{
        backgroundColor: t.accent,
        marginTop: -t.margins.top,
        marginLeft: -t.margins.left,
        marginRight: -t.margins.right,
        paddingLeft: t.margins.left,
        paddingRight: t.margins.right,
        paddingVertical: 24,
        marginBottom: 14,
      }}
    >
      <Text style={{ fontFamily: t.fonts.bold, fontSize: t.fs(24), color: t.onBand }}>{name}</Text>
      {role ? (
        <Text style={{ marginTop: 2, fontSize: t.fs(12), color: t.onBand }}>{role}</Text>
      ) : null}
      {items.length ? (
        <View style={{ marginTop: 8, flexDirection: "row", flexWrap: "wrap" }}>
          {items.map((c) => (
            <Text key={c} style={{ fontSize: t.fs(9), color: t.onBandSoft, marginRight: 16 }}>
              {c}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function SectionTitle({ title, spec, t }: { title: string; spec: VariantSpec; t: VariantTokens }) {
  const base = {
    fontFamily: t.fonts.bold,
    fontSize: t.fs(10.5),
    letterSpacing: 0.8,
    textTransform: "uppercase" as const,
    color: t.accent,
    marginBottom: 6,
  };
  return (
    <Text
      minPresenceAhead={48}
      style={
        spec.titleStyle === "bar"
          ? { ...base, backgroundColor: t.tint, paddingVertical: 3, paddingHorizontal: 6 }
          : { ...base, borderBottomWidth: 1, borderBottomColor: t.accent, paddingBottom: 3 }
      }
    >
      {title}
    </Text>
  );
}

function CompanyLine({ parts, t }: { parts: (string | undefined)[]; t: VariantTokens }) {
  const line = parts.filter(Boolean).join("  •  ");
  return line ? (
    <Text style={{ fontSize: t.fs(9.5), color: t.muted, marginBottom: 3 }}>{line}</Text>
  ) : null;
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
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "flex-start",
        marginBottom: 1,
      }}
    >
      <Text
        style={{
          flex: 1,
          paddingRight: 8,
          fontFamily: t.fonts.bold,
          fontSize: t.fs(10.5),
          color: t.dark,
        }}
      >
        {title}
      </Text>
      {date ? (
        <Text style={{ fontSize: t.fs(9.5), color: dateColor ?? t.muted, textAlign: "right" }}>
          {date}
        </Text>
      ) : null}
    </View>
  );
}

function renderBlocks(
  section: ResumeSection,
  spec: VariantSpec,
  t: VariantTokens,
  rs: RichTextStyles,
): ReactNode[] {
  const c = section.content;
  switch (c.kind) {
    case "text":
      return c.value.trim()
        ? [<RichText key="t" value={c.value} s={rs} align={section.align} />]
        : [];

    case "list": {
      if (!c.items.length) return [];
      if (section.type === "skills") {
        if (spec.skills === "chips") {
          return [
            <View key="chips" style={{ flexDirection: "row", flexWrap: "wrap" }}>
              {c.items.map((item, i) => (
                <View
                  key={`${item}-${i}`}
                  style={{
                    backgroundColor: t.tint,
                    borderRadius: 3,
                    paddingHorizontal: 6,
                    paddingVertical: 2.5,
                    marginRight: 5,
                    marginBottom: 5,
                  }}
                >
                  <Text style={{ fontSize: t.fs(9), color: t.body }}>{item}</Text>
                </View>
              ))}
            </View>,
          ];
        }
        if (spec.skills === "grouped") {
          return groupSkills(c.items).map((g) => (
            <View key={g.label} style={{ flexDirection: "row", marginBottom: 2 }}>
              <Text
                style={{ width: 78, fontFamily: t.fonts.bold, fontSize: t.fs(9.5), color: t.dark }}
              >
                {g.label}
              </Text>
              <Text style={{ flex: 1, fontSize: t.fs(9.5), lineHeight: t.lh(1.4), color: t.body }}>
                {g.items.join(", ")}
              </Text>
            </View>
          ));
        }
        // One Text per skill so a long list wraps between skills, never inside a word.
        return [
          <View key="inline" style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {c.items.map((item, i) => (
              <Text
                key={`${item}-${i}`}
                style={{ fontSize: t.fs(10), lineHeight: t.lh(1.5), color: t.body }}
              >
                {item}
                {i < c.items.length - 1 ? (
                  <Text style={{ color: t.muted }}>{"   |   "}</Text>
                ) : null}
              </Text>
            ))}
          </View>,
        ];
      }
      if (section.id === "languages" && spec.languagesAsInfo) {
        return [
          <View key="lang" style={{ flexDirection: "row", marginBottom: 2 }}>
            <Text
              style={{ width: 78, fontFamily: t.fonts.bold, fontSize: t.fs(9.5), color: t.dark }}
            >
              Languages
            </Text>
            <Text style={{ flex: 1, fontSize: t.fs(9.5), color: t.body }}>
              {languageNames(c.items)}
            </Text>
          </View>,
        ];
      }
      return [
        <Text key="l" style={{ fontSize: t.fs(10), lineHeight: t.lh(1.45), color: t.body }}>
          {c.items.join("  ·  ")}
        </Text>,
      ];
    }

    case "experience": {
      const items = (c.items as ExperienceItem[]).map((exp) => (
        <View key={exp.id} style={{ marginBottom: 8 * t.gap }} wrap={false}>
          {spec.timeline ? (
            <View
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
          {exp.description ? <RichText value={exp.description} s={rs} /> : null}
          {exp.achievements?.map((a, i) => (
            <BulletLine key={i} s={rs}>
              {a}
            </BulletLine>
          ))}
        </View>
      ));
      if (!spec.timeline) return items;
      return [
        <View
          key="timeline"
          style={{
            marginLeft: 3,
            paddingLeft: 14,
            borderLeftWidth: 1,
            borderLeftColor: t.tintLine,
          }}
        >
          {items}
        </View>,
      ];
    }

    case "education":
      return (c.items as EducationItem[]).map((edu) => (
        <View key={edu.id} style={{ marginBottom: 6 * t.gap }} wrap={false}>
          <ItemHeader
            t={t}
            title={`${edu.degree}${edu.fieldOfStudy ? ` in ${edu.fieldOfStudy}` : ""}`}
            date={dateRange(edu.startDate, edu.endDate)}
          />
          <CompanyLine t={t} parts={[edu.institution, edu.location]} />
          {edu.description ? <RichText value={edu.description} s={rs} /> : null}
        </View>
      ));

    case "certification":
      return (c.items as CertificationItem[]).map((cert) => {
        const year = formatDate(cert.issueDate);
        const line = `${cert.name}${cert.issuingOrganization ? ` — ${cert.issuingOrganization}` : ""}${year ? ` (${year})` : ""}`;
        return (
          <BulletLine key={cert.id} s={rs}>
            {line}
          </BulletLine>
        );
      });

    case "link":
      return (c.items as LinkItem[]).map((link) => (
        <Link
          key={link.id}
          src={link.url}
          style={{ fontSize: t.fs(9.5), color: t.accent, textDecoration: "none", marginBottom: 2 }}
        >
          {link.label}: {link.url}
        </Link>
      ));

    default:
      return [];
  }
}

export function makeVariantResume(spec: VariantSpec) {
  return function VariantResume({ resume }: { resume: ResumeSchema }) {
    const t = buildVariantTokens(spec, resume.layout);
    const rs = richStyles(t);
    return (
      <Document title={resume.title}>
        <Page
          size="A4"
          style={{
            paddingTop: t.margins.top,
            paddingBottom: Math.max(t.margins.bottom, WATERMARK_RESERVE),
            paddingLeft: t.margins.left,
            paddingRight: t.margins.right,
            fontFamily: t.fonts.regular,
            fontSize: t.fs(10),
            color: t.body,
          }}
        >
          <Header resume={resume} spec={spec} t={t} />
          {resume.sections.map((section) => {
            const blocks = renderBlocks(section, spec, t, rs);
            if (blocks.length === 0) return null;
            return (
              <View key={section.id} style={{ marginTop: 10 * t.gap }}>
                <SectionTitle title={section.title} spec={spec} t={t} />
                {blocks}
              </View>
            );
          })}
          <ResumeWatermark />
        </Page>
      </Document>
    );
  };
}

export const ModernResume = makeVariantResume(VARIANTS.modern);
export const ProfessionalResume = makeVariantResume(VARIANTS.professional);
export const PracticalResume = makeVariantResume(VARIANTS.practical);
export const TechnicalResume = makeVariantResume(VARIANTS.technical);
