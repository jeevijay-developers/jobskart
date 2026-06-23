import { z } from "zod";

// Strip HTML tags + control chars, collapse internal whitespace
export const sanitizeText = (s: string) =>
  s
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();

// Title-case (first letter of each word) for names
export const titleCase = (s: string) =>
  s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w === "." ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");

const NAME_RE = /^[A-Za-z][A-Za-z .]*[A-Za-z.]$/;

export const fullNameSchema = z
  .string()
  .transform((v) => sanitizeText(v))
  .pipe(
    z
      .string()
      .min(3, "Name must be at least 3 characters")
      .max(80, "Name must be under 80 characters")
      .regex(NAME_RE, "Only letters, spaces and dots are allowed"),
  );

export const mobileSchema = z
  .string()
  .transform((v) => v.replace(/\D/g, "").slice(-10))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number"));

export const headlineSchema = z
  .string()
  .transform(sanitizeText)
  .pipe(z.string().max(80, "Headline must be under 80 characters"))
  .optional()
  .or(z.literal(""));

export const descriptionSchema = z
  .string()
  .transform((v) =>
    v
      .replace(/<[^>]*>/g, "")
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
      .replace(/\r\n/g, "\n")
      .trim(),
  )
  .pipe(z.string().max(1500, "Description must be under 1500 characters"));

export const dobSchema = z
  .string()
  .optional()
  .refine((v) => {
    if (!v) return true;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return false;
    const age = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
    return age >= 14 && age <= 80;
  }, "You must be at least 14 years old");

export const QUALIFICATIONS = [
  "10th or Below",
  "12th Pass",
  "Diploma",
  "Graduate",
  "Post Graduate",
  "Doctorate",
] as const;

export const qualificationSchema = z.enum(QUALIFICATIONS);

export const RESUME_ACCEPT = ".pdf,.doc,.docx,.png,.jpg,.jpeg";
export const RESUME_MIME = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
];
export const RESUME_MAX_BYTES = 5 * 1024 * 1024;

export function validateResumeFile(file: File): string | null {
  if (file.size > RESUME_MAX_BYTES) return "Resume must be under 5 MB.";
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const allowedExts = ["pdf", "doc", "docx", "png", "jpg", "jpeg"];
  if (!allowedExts.includes(ext)) return "Only PDF, DOC, DOCX, PNG, JPG files are allowed.";
  if (file.type && !RESUME_MIME.includes(file.type)) return "Unsupported file type.";
  return null;
}
