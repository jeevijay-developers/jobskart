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
      .min(3, "Please enter your full name")
      .max(80, "Name must be under 80 characters")
      .regex(NAME_RE, "Only letters, spaces and dots are allowed"),
  );

const FAKE_MOBILE_PATTERNS = new Set([
  "0123456789",
  "1234567890",
  "9876543210",
  "0987654321",
]);

const MOBILE_ERROR = "Enter a valid 10-digit Indian mobile number starting with 6-9";

export const mobileSchema = z
  .string()
  .transform((v) => v.replace(/\D/g, ""))
  .pipe(
    z
      .string()
      .regex(/^[6-9]\d{9}$/, MOBILE_ERROR)
      .refine((v) => !/^(\d)\1{9}$/.test(v), MOBILE_ERROR)
      .refine((v) => !FAKE_MOBILE_PATTERNS.has(v), MOBILE_ERROR),
  );

const CITY_TOWN_RE = /^[A-Za-z][A-Za-z .'-]*[A-Za-z.]$/;

export const cityTownSchema = z
  .string()
  .transform((v) => sanitizeText(v))
  .pipe(
    z
      .string()
      .min(2, "Enter a valid city/town name")
      .max(80, "City/town name must be under 80 characters")
      .regex(CITY_TOWN_RE, "Only letters, spaces, hyphens and apostrophes are allowed"),
  );

// Matches the CHECK constraint on profiles.email / contact_messages.email in supabase/migrations.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$/;
const SYNTHETIC_EMAIL_RE = /^m\d+@jobskart\.app$/i;

export const isSyntheticEmail = (email: string | null | undefined) =>
  !!email && SYNTHETIC_EMAIL_RE.test(email);

export const emailSchema = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(
    z
      .string()
      .min(1, "Please enter your email")
      .max(200, "Email must be under 200 characters")
      .regex(EMAIL_RE, "Enter a valid email address")
      .refine((v) => !isSyntheticEmail(v), "Enter a valid email address"),
  );

export const headlineSchema = z
  .string()
  .transform(sanitizeText)
  .pipe(z.string().max(200, "Headline must be under 200 characters"))
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

// Official GSTIN format: 2-digit state code, 10-char PAN, 1-char entity code
// (1-9 or A-Z for multiple registrations on one PAN), literal 'Z', 1
// alphanumeric checksum character. Matches the server-side check in
// supabase/functions/_shared/gst.ts (keep both in sync if this ever changes).
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const GSTIN_ERROR = "Enter a valid 15-character GSTIN";

// Strips anything that isn't a letter or digit, uppercases, and caps at 15
// characters — use this in onChange so spaces/symbols/lowercase never even
// reach state, not just at submit time.
export const sanitizeGstinInput = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 15);

// Plain helper for pages using raw useState (not a zod-backed form). Returns
// null for a valid or empty value (callers decide if the field is required),
// or an error string.
export function validateGstin(raw: string, { required = false }: { required?: boolean } = {}): string | null {
  const v = sanitizeGstinInput(raw);
  if (!v) return required ? "Enter your GST number." : null;
  return GSTIN_RE.test(v) ? null : GSTIN_ERROR;
}

export const gstinSchema = z
  .string()
  .transform(sanitizeGstinInput)
  .pipe(z.string().regex(GSTIN_RE, GSTIN_ERROR));

// Accepts a bare domain (example.com), a www. host, or a full http(s):// URL —
// HTTPS is never required. Each label is 1-63 chars, letters/digits/hyphens
// (no leading/trailing hyphen), 2+ letter TLD, optional path/query/fragment.
const WEBSITE_RE =
  /^(https?:\/\/)?(www\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}(\/[^\s]*)?$/i;
const WEBSITE_ERROR = "Enter a valid website (e.g. example.com)";

// Strips whitespace only — unlike GSTIN this is free text (case, path and
// query all matter), so onChange should just drop spaces, not reshape it.
export const sanitizeWebsiteInput = (s: string) => s.replace(/\s+/g, "");

// Plain helper for pages using raw useState (not a zod-backed form). Returns
// null for a valid or empty value (callers decide if the field is required),
// or an error string.
export function validateWebsite(raw: string, { required = false }: { required?: boolean } = {}): string | null {
  const v = sanitizeWebsiteInput(raw.trim());
  if (!v) return required ? "Enter your website." : null;
  return WEBSITE_RE.test(v) ? null : WEBSITE_ERROR;
}

export const websiteSchema = z
  .string()
  .transform((s) => sanitizeWebsiteInput(s.trim()))
  .pipe(z.string().regex(WEBSITE_RE, WEBSITE_ERROR));

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

export const AVATAR_ACCEPT = ".png,.jpg,.jpeg,.webp";
export const AVATAR_MIME = ["image/png", "image/jpeg", "image/webp"];
// Matches the "avatars" Supabase Storage bucket's file_size_limit (2 MB).
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export function validateAvatarFile(file: File): string | null {
  if (file.size > AVATAR_MAX_BYTES) return "Photo must be under 2 MB.";
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const allowedExts = ["png", "jpg", "jpeg", "webp"];
  if (!allowedExts.includes(ext)) return "Only PNG, JPG or WEBP images are allowed.";
  if (file.type && !AVATAR_MIME.includes(file.type)) return "Unsupported image type.";
  return null;
}
