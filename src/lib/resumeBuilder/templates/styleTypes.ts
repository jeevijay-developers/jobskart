// Type-only module shared by the template style builder, the section renderer
// and the rich-text renderer (kept separate so none of them import each other).
import type { Style } from "@react-pdf/types";

export interface FontSet {
  regular: string;
  bold: string;
  italic: string;
}

export type RichTextStyles = {
  fonts: FontSet;
  text: Style;
  bullet: Style; // row container: indent + gap between bullets
  bulletGlyph: Style; // fixed-width glyph column
  bulletText: Style; // flex:1 text column — wrapped lines align under the first word
};

export type SectionStyles = RichTextStyles & {
  section: Style;
  sectionTitle: Style;
  itemBlock: Style;
  itemHeader: Style; // row: title left, date right
  itemTitle: Style;
  itemDate: Style;
  itemMeta: Style;
  link: Style;
};

export type TemplateStyles = SectionStyles & {
  page: Style;
  header: Style;
  name: Style;
  contact: Style;
};
