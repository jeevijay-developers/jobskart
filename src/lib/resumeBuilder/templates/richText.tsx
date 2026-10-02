// Constrained rich text for resume free-text fields: **bold**, *italic* and
// "- " bullet lines only. Deliberately not HTML — ATS parsers choke on fancy
// formatting, and a tiny markup avoids any HTML-injection surface. Rendered
// to real react-pdf <Text> nodes, so preview and PDF stay identical.
import type { ReactNode } from "react";
import { Text, View } from "@react-pdf/renderer";
import type { TextAlign } from "../schema";
import type { RichTextStyles } from "./styleTypes";

type Span = { text: string; bold?: boolean; italic?: boolean };
type Block = { bullet: boolean; spans: Span[] };

const INLINE_RE = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;

function parseInline(line: string): Span[] {
  return line
    .split(INLINE_RE)
    .filter(Boolean)
    .map((part) => {
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
        return { text: part.slice(2, -2), bold: true };
      }
      if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
        return { text: part.slice(1, -1), italic: true };
      }
      return { text: part };
    });
}

export function parseRichText(value: string): Block[] {
  return value
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0)
    .map((line) => {
      const m = line.match(/^\s*[-•]\s+(.*)$/);
      return m ? { bullet: true, spans: parseInline(m[1]) } : { bullet: false, spans: parseInline(line) };
    });
}

/**
 * One bullet with a hanging indent: the glyph sits in its own fixed-width
 * column, so wrapped lines align under the first word instead of under the
 * bullet. The single bullet renderer for the whole resume (rich text and
 * experience achievements both use it).
 */
export function BulletLine({ children, s }: { children: ReactNode; s: Pick<RichTextStyles, "bullet" | "bulletGlyph" | "bulletText"> }) {
  return (
    <View style={s.bullet} wrap={false}>
      <Text style={s.bulletGlyph}>{"•"}</Text>
      <Text style={s.bulletText}>{children}</Text>
    </View>
  );
}

export function RichText({ value, s, align }: { value: string; s: RichTextStyles; align?: TextAlign }) {
  const blocks = parseRichText(value);
  const textStyle = align && align !== "left" ? { ...s.text, textAlign: align } : s.text;
  return (
    <View>
      {blocks.map((block, i) => {
        const spans = block.spans.map((span, j) => (
          <Text key={j} style={span.bold ? { fontFamily: s.fonts.bold } : span.italic ? { fontFamily: s.fonts.italic } : undefined}>
            {span.text}
          </Text>
        ));
        return block.bullet ? (
          <BulletLine key={i} s={s}>{spans}</BulletLine>
        ) : (
          <Text key={i} style={textStyle}>{spans}</Text>
        );
      })}
    </View>
  );
}
