import { XMLValidator } from "fast-xml-parser";
import {
  LOGO_EMPTY_ERROR,
  LOGO_SIZE_ERROR,
  LOGO_TYPE_ERROR,
  MAX_LOGO_SIZE_BYTES,
  logoKindFromExt,
  logoKindFromMime,
  type LogoKind,
} from "./company-logo";

export class LogoValidationError extends Error {
  constructor(
    message: string,
    public status: 413 | 415 | 400,
  ) {
    super(message);
  }
}

// SVG is rejected (not sanitized) if it contains anything that can execute or
// pull in remote content.
const SVG_FORBIDDEN: RegExp[] = [
  /<!DOCTYPE/i,
  /<!ENTITY/i,
  /<script/i,
  /<foreignObject/i,
  /<(iframe|embed|object|audio|video|animate|set|handler)\b/i,
  /\son[a-z]+\s*=/i,
  /javascript:/i,
  /\b(?:xlink:)?href\s*=\s*["']\s*(?!#)/i, // only in-document #fragment refs allowed
  /url\(\s*["']?\s*(?!#)/i,
  /@import/i,
];

function validateSvg(bytes: Uint8Array): void {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const body = text.replace(/^﻿/, "");
  const rootOk = /^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>/]/i.test(body);
  if (!rootOk || XMLValidator.validate(body) !== true) throw new LogoValidationError(LOGO_TYPE_ERROR, 415);
  if (SVG_FORBIDDEN.some((re) => re.test(body))) {
    throw new LogoValidationError("This SVG contains unsafe content and cannot be uploaded.", 415);
  }
}

/**
 * Single source of truth for logo validation. Detects the real type from the
 * bytes and requires it to agree with the declared extension and MIME type.
 */
export async function validateLogoUpload(input: {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
}): Promise<{ kind: LogoKind; ext: string; mime: string }> {
  const { bytes, fileName, mimeType } = input;
  if (bytes.length === 0) throw new LogoValidationError(LOGO_EMPTY_ERROR, 400);
  if (bytes.length > MAX_LOGO_SIZE_BYTES) throw new LogoValidationError(LOGO_SIZE_ERROR, 413);

  const declaredExt = logoKindFromExt(fileName);
  const declaredMime = logoKindFromMime(mimeType);
  if (!declaredExt || !declaredMime || declaredExt !== declaredMime) {
    throw new LogoValidationError(LOGO_TYPE_ERROR, 415);
  }

  let detected: LogoKind | null = null;
  if (declaredExt === "svg") {
    try {
      validateSvg(bytes);
    } catch (e) {
      if (e instanceof LogoValidationError) throw e;
      throw new LogoValidationError(LOGO_TYPE_ERROR, 415);
    }
    detected = "svg";
  } else {
    const { fileTypeFromBuffer } = await import("file-type");
    const ft = await fileTypeFromBuffer(bytes);
    detected =
      ft?.mime === "image/jpeg"
        ? "jpeg"
        : ft?.mime === "image/png"
          ? "png"
          : ft?.mime === "image/webp"
            ? "webp"
            : null;
  }
  if (!detected || detected !== declaredExt) throw new LogoValidationError(LOGO_TYPE_ERROR, 415);

  const ext = detected === "jpeg" ? "jpg" : detected;
  const mime = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp", svg: "image/svg+xml" }[detected];
  return { kind: detected, ext, mime };
}
