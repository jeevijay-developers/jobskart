// Pure certificate layout + placeholder logic, shared by the admin preview and the PDF generator so
// the preview can never drift from the real output. Positions are percentages of the template
// image (x/y = top-left of the box, w = box width), so any template size/aspect works.
//
// A later drag-and-drop editor only needs to produce/store a `CertificateLayout` and pass it in
// where DEFAULT_LAYOUT is used — the data model (blocks + images with percent boxes) is the same.

export const CERT_PLACEHOLDERS = [
  "candidate_name",
  "course_name",
  "certificate_id",
  "issue_date",
  "score",
  "valid_until",
  "provider",
] as const;
export type CertPlaceholder = (typeof CERT_PLACEHOLDERS)[number];
export type CertValues = Record<CertPlaceholder, string>;

/** Replaces only the supported {{placeholders}}; anything else becomes empty, never an error. */
export function renderCertText(template: string, values: CertValues): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, key: string) => {
    const k = key.toLowerCase() as CertPlaceholder;
    return (CERT_PLACEHOLDERS as readonly string[]).includes(k) ? (values[k] ?? "") : "";
  });
}

export type CertTextBlock = {
  id: string;
  text: string; // may contain {{placeholders}}
  x: number;
  y: number;
  w: number;
  align: "left" | "center" | "right";
  /** Font size as a percentage of the page height. */
  size: number;
  bold?: boolean;
  color?: string;
  /** Skip the block when a placeholder it uses is empty (e.g. valid_until for non-expiring certs). */
  skipIfEmpty?: CertPlaceholder;
  /**
   * Solid colour painted behind the text. A template is a flat image, so any placeholder text
   * printed in it can't be deleted; this patch (sampled from the template's own background where
   * the admin placed the field) hides it so only the real value shows.
   */
  cover?: string | null;
  /** Exact area (in % of the page) to mask — the printed text's detected bounding box. */
  coverBox?: { x: number; y: number; w: number; h: number } | null;
};

export type CertImageSlot = "logo" | "signature" | "signature2";
export type CertImageBlock = { slot: CertImageSlot; x: number; y: number; w: number; h: number };

export type CertificateLayout = { text: CertTextBlock[]; images: CertImageBlock[] };

export const DEFAULT_LAYOUT: CertificateLayout = {
  text: [
    { id: "candidate_name", text: "{{candidate_name}}", x: 10, y: 40, w: 80, align: "center", size: 6, bold: true, color: "#111827" },
    { id: "completed", text: "has successfully completed", x: 10, y: 52, w: 80, align: "center", size: 2.6, color: "#374151" },
    { id: "course_name", text: "{{course_name}}", x: 10, y: 58, w: 80, align: "center", size: 4, bold: true, color: "#111827" },
    { id: "score", text: "with a score of {{score}}%", x: 10, y: 67, w: 80, align: "center", size: 2.6, color: "#374151" },
    { id: "certificate_id", text: "Certificate No. {{certificate_id}}", x: 6, y: 90, w: 38, align: "left", size: 2, color: "#4B5563" },
    { id: "issue_date", text: "Issued on {{issue_date}}", x: 62, y: 90, w: 32, align: "right", size: 2, color: "#4B5563" },
    { id: "valid_until", text: "Valid until {{valid_until}}", x: 62, y: 93.5, w: 32, align: "right", size: 2, color: "#4B5563", skipIfEmpty: "valid_until" },
    { id: "provider", text: "{{provider}}", x: 40, y: 89, w: 20, align: "center", size: 2.2, bold: true, color: "#374151" },
  ],
  images: [
    { slot: "logo", x: 6, y: 5, w: 16, h: 14 },
    { slot: "signature", x: 18, y: 77, w: 20, h: 10 },
    { slot: "signature2", x: 62, y: 77, w: 20, h: 10 },
  ],
};

/** Per-field admin overrides, stored in certificate_config.layout (no schema change). */
export type BlockOverride = {
  x?: number;
  y?: number;
  w?: number;
  hidden?: boolean;
  cover?: string | null;
  /** Explicit cover box (% of page): left, top, width, height. */
  cx?: number;
  cy?: number;
  cw?: number;
  ch?: number;
};
export type LayoutOverrides = Record<string, BlockOverride>;
export const COVER_RE = /^#[0-9a-fA-F]{6}$/;

const clampPct = (n: unknown, lo: number, hi: number): number | undefined =>
  typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : undefined;

/** Default layout with the admin's per-field position / visibility / cover overrides applied. */
export function mergeLayout(overrides?: LayoutOverrides | null): CertificateLayout {
  return {
    images: DEFAULT_LAYOUT.images,
    text: DEFAULT_LAYOUT.text
      .filter((b) => !overrides?.[b.id]?.hidden)
      .map((b) => {
        const o = overrides?.[b.id];
        if (!o) return b;
        const w = clampPct(o.w, 5, 100) ?? b.w;
        return {
          ...b,
          w,
          x: clampPct(o.x, 0, 100 - w) ?? b.x,
          y: clampPct(o.y, 0, 98) ?? b.y,
          cover: typeof o.cover === "string" && COVER_RE.test(o.cover) ? o.cover : null,
          coverBox: (() => {
            const cx = clampPct(o.cx, 0, 100);
            const cy = clampPct(o.cy, 0, 100);
            const cw = clampPct(o.cw, 1, 100);
            const ch = clampPct(o.ch, 0.5, 100);
            return cx != null && cy != null && cw != null && ch != null ? { x: cx, y: cy, w: cw, h: ch } : null;
          })(),
        };
      }),
  };
}

/** Box (in % of the page) a block's cover patch occupies — shared by the preview and the PDF. */
export function coverRect(b: CertTextBlock): { left: number; top: number; width: number; height: number } {
  if (b.coverBox) return { left: b.coverBox.x, top: b.coverBox.y, width: b.coverBox.w, height: b.coverBox.h };
  return { left: b.x - 0.4, top: b.y - b.size * 0.15, width: b.w + 0.8, height: b.size * 1.5 };
}

export type CertificateConfig = {
  templatePath?: string | null;
  logoPath?: string | null;
  signaturePath?: string | null;
  signature2Path?: string | null;
  issuerName?: string | null;
  prefix?: string | null;
  layout?: LayoutOverrides | null;
};

export const DEFAULT_CERT_PREFIX = "JK-CERT";
export const CERT_ASSET_MAX_BYTES = 5 * 1024 * 1024;
export const CERT_ASSET_MIME = ["image/png", "image/jpeg"];
/** Storage paths must stay inside the templates/ or assets/ folders of the certificates bucket. */
export const CERT_ASSET_PATH_RE = /^(templates|assets)\/[A-Za-z0-9._-]+$/;
export const CERT_PREFIX_RE = /^[A-Za-z0-9-]{1,16}$/;

export function certPrefix(config: CertificateConfig | null | undefined): string {
  const p = config?.prefix?.trim();
  return p && CERT_PREFIX_RE.test(p) ? p : DEFAULT_CERT_PREFIX;
}

export function formatCertDate(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

export function addMonths(d: Date, months: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + months);
  return r;
}

/** Natural pixel size of a PNG or JPEG from its header bytes (no dependency); null if unknown. */
export function imageSize(bytes: Uint8Array): { width: number; height: number; format: "png" | "jpg" } | null {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: dv.getUint32(16), height: dv.getUint32(20), format: "png" };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = bytes[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: (bytes[i + 7] << 8) | bytes[i + 8], height: (bytes[i + 5] << 8) | bytes[i + 6], format: "jpg" };
      }
      i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
    }
  }
  return null;
}
