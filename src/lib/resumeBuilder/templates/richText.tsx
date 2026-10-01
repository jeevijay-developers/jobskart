// Constrained rich text for resume free-text fields: **bold**, *italic* and
// "- " bullet lines only. Deliberately not HTML — ATS parsers choke on fancy
// formatting, and a tiny markup avoids any HTML-injection surface. Rendered
// to real react-pdf <Text> nodes, so preview and PDF stay identical.
import { Text, View } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";

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

export function RichText({ value, style, bulletStyle }: { value: string; style: Style; bulletStyle: Style }) {
  const blocks = parseRichText(value);
  return (
    <View>
      {blocks.map((block, i) => (
        <Text key={i} style={block.bullet ? bulletStyle : style}>
          {block.bullet ? "•  " : ""}
          {block.spans.map((span, j) => (
            <Text
              key={j}
              style={{
                fontFamily: span.bold ? "Helvetica-Bold" : span.italic ? "Helvetica-Oblique" : "Helvetica",
              }}
            >
              {span.text}
            </Text>
          ))}
        </Text>
      ))}
    </View>
  );
}
