// Client-safe rules for company logo uploads. The server re-validates everything
// (see company-logo.server.ts) — this file only gives quick feedback in the UI.

export const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB, matches the company-logos bucket limit

export const LOGO_TYPES = {
  jpeg: { mime: "image/jpeg", exts: ["jpg", "jpeg"] },
  png: { mime: "image/png", exts: ["png"] },
  webp: { mime: "image/webp", exts: ["webp"] },
  svg: { mime: "image/svg+xml", exts: ["svg"] },
} as const;

export type LogoKind = keyof typeof LOGO_TYPES;

export const LOGO_ACCEPT =
  "image/jpeg,image/png,image/webp,image/svg+xml,.jpg,.jpeg,.png,.webp,.svg";

export const LOGO_TYPE_ERROR = "Only JPG, JPEG, PNG, WEBP and SVG images are allowed.";
export const LOGO_SIZE_ERROR = `Logo is too large. Maximum size is ${MAX_LOGO_SIZE_BYTES / (1024 * 1024)} MB.`;
export const LOGO_EMPTY_ERROR = "The selected file is empty.";

export function logoKindFromExt(fileName: string): LogoKind | null {
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  for (const [kind, def] of Object.entries(LOGO_TYPES)) {
    if ((def.exts as readonly string[]).includes(ext)) return kind as LogoKind;
  }
  return null;
}

export function logoKindFromMime(mime: string): LogoKind | null {
  const m = mime.toLowerCase();
  for (const [kind, def] of Object.entries(LOGO_TYPES)) {
    if (def.mime === m) return kind as LogoKind;
  }
  return null;
}

/** Quick client-side check; returns an error message or null. */
export function checkLogoFile(file: File): string | null {
  if (file.size === 0) return LOGO_EMPTY_ERROR;
  const byExt = logoKindFromExt(file.name);
  const byMime = logoKindFromMime(file.type);
  if (!byExt || !byMime || byExt !== byMime) return LOGO_TYPE_ERROR;
  if (file.size > MAX_LOGO_SIZE_BYTES) return LOGO_SIZE_ERROR;
  return null;
}

export async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) {
    bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
