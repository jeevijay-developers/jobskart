import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { chat } from "@/lib/ai/provider";


const inputSchema = z.object({
  fileName: z.string().min(1),
  base64: z.string().min(20),
  mimeType: z.string().min(3),
});

const nstr = z.union([z.string(), z.null(), z.undefined()]).transform((v) => (v ?? "").toString());
const nstrOpt = z.union([z.string(), z.null(), z.undefined()]).transform((v) => (v == null || v === "" ? null : String(v)));
const nyear = z.union([z.number(), z.string(), z.null(), z.undefined()]).transform((v) => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseInt(String(v).replace(/\D/g, ""), 10);
  return Number.isFinite(n) && n >= 1950 && n <= 2099 ? n : null;
});
const nbool = z.union([z.boolean(), z.string(), z.null(), z.undefined()]).transform((v) => v === true || v === "true");

const ParsedResume = z.object({
  full_name: nstrOpt,
  email: nstrOpt,
  mobile: nstrOpt,
  headline: nstrOpt,
  city: nstrOpt,
  years_experience: z.union([z.number(), z.string(), z.null(), z.undefined()]).transform((v) => {
    if (v == null || v === "") return null;
    const n = typeof v === "number" ? v : parseInt(String(v), 10);
    return Number.isFinite(n) && n >= 0 && n <= 60 ? n : null;
  }),
  skills: z.union([z.array(z.string()), z.null(), z.undefined()])
    .transform((v) => (Array.isArray(v) ? v.filter((s) => typeof s === "string" && s.trim()) : []))
    .pipe(z.array(z.string()).max(40)),
  experiences: z.union([
    z.array(z.object({
      job_title: nstr, company_name: nstr,
      start_date: nstrOpt, end_date: nstrOpt,
      is_current: nbool, description: nstr,
    }).catch(() => null as never)),
    z.null(), z.undefined(),
  ]).transform((v) => (Array.isArray(v) ? v.filter(Boolean) : [])).pipe(z.array(z.any()).max(20)),
  education: z.union([
    z.array(z.object({
      level: nstr, board_or_university: nstr, institute: nstr,
      year_of_passing: nyear, marks: nstr,
    }).catch(() => null as never)),
    z.null(), z.undefined(),
  ]).transform((v) => (Array.isArray(v) ? v.filter(Boolean) : [])).pipe(z.array(z.any()).max(10)),
});

export type ParsedResumePayload = z.infer<typeof ParsedResume>;

const SYSTEM_PROMPT = `You extract structured candidate data from resume text. Reply with ONLY a JSON object (no prose, no markdown fences):
{
  "full_name": string | null,
  "email": string | null,
  "mobile": string | null,
  "headline": string | null,
  "city": string | null,
  "years_experience": number | null,
  "skills": string[],
  "experiences": [{ "job_title": string, "company_name": string, "start_date": "YYYY-MM-DD" | null, "end_date": "YYYY-MM-DD" | null, "is_current": boolean, "description": string }],
  "education": [{ "level": "10th" | "12th" | "Diploma" | "Graduate" | "Post Graduate" | "PhD" | "Other", "board_or_university": string, "institute": string, "year_of_passing": number | null, "marks": string }]
}
Rules:
- Extract every field that appears in the text — name, email, 10-digit Indian mobile (strip country code), city, skills (8–25 concise keywords).
- If the text clearly contains a value, do NOT return null for that field.
- Use null / empty arrays only when truly absent. Never invent values.`;

async function extractPdfText(base64: string): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : String(text ?? "");
}

async function callGateway(userText: string, images?: { mime: string; b64: string }[]) {
  return chat({
    system: SYSTEM_PROMPT,
    user: userText,
    images,
    json: true,
  });
}


export const parseResume = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }) => {
    const isPdf = data.mimeType === "application/pdf" || data.fileName.toLowerCase().endsWith(".pdf");
    const isImage = data.mimeType.startsWith("image/");

    let raw: string;

    if (isPdf) {
      let text = "";
      try {
        text = (await extractPdfText(data.base64)).trim();
      } catch (e) {
        console.error("[resume] pdf extract failed:", e);
      }
      if (text.length < 30) {
        throw new Error("Couldn't read this PDF. It may be a scanned image — please upload it as JPG/PNG or fill the fields manually.");
      }
      // Cap text to keep token use sane
      const trimmed = text.slice(0, 18000);
      raw = await callGateway(`Parse this resume text and return the JSON.\n\n---RESUME TEXT---\n${trimmed}`);
    } else if (isImage) {
      raw = await callGateway("Parse this resume image and return the JSON.", [
        { mime: data.mimeType, b64: data.base64 },
      ]);
    } else {

      throw new Error("Unsupported file. Please upload a PDF or image (JPG/PNG).");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const cleaned = raw.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(cleaned);
    }

    const result = ParsedResume.parse(parsed);
    const hasAnything =
      !!(result.full_name || result.email || result.mobile || result.headline || result.city) ||
      (result.skills?.length ?? 0) > 0 ||
      (result.experiences?.length ?? 0) > 0 ||
      (result.education?.length ?? 0) > 0;

    if (!hasAnything) {
      throw new Error("Couldn't find details in this resume. Please try a clearer file or fill the fields manually.");
    }
    return result;
  });
