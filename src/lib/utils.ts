import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * crypto.randomUUID() only exists in "secure contexts" (https, or
 * http://localhost) — it throws "crypto.randomUUID is not a function" when
 * the app is opened over plain http from a LAN IP (e.g. testing on a phone
 * against a dev server at http://192.168.x.x:8080), which is exactly when
 * this is most likely to be hit on a resume/file upload path. crypto.getRandomValues()
 * has no such restriction, so build the id from that instead when
 * randomUUID isn't available.
 */
export function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // Last-resort fallback — never expected in a browser, only here so this
  // function can't itself throw and block an upload.
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}
