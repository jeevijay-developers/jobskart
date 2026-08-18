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

const UNREADABLE =
  "We could not read this file. Please fill your details manually — it takes 2 minutes.";

async function extractPdfText(base64: string): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : String(text ?? "");
}

async function extractDocxText(base64: string): Promise<string> {
  const mammoth = await import("mammoth");
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const res = await mammoth.extractRawText({ arrayBuffer: bytes.buffer as ArrayBuffer });
  return String(res?.value ?? "");
}

async function callGateway(
  userText: string,
  images?: { mime: string; b64: string }[],
  files?: { mime: string; b64: string; name?: string }[],
) {
  return chat({ system: SYSTEM_PROMPT, user: userText, images, files, json: true });
}

const fromText = (text: string) =>
  callGateway(
    `Parse this resume text and return the JSON.\n\n---RESUME TEXT---\n${text.slice(0, 18000)}`,
  );

export const parseResume = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }) => {
    const mime = data.mimeType.toLowerCase();
    const name = data.fileName.toLowerCase();
    const isPdf = mime === "application/pdf" || name.endsWith(".pdf");
    const isImage = mime.startsWith("image/");
    const isDocx =
      mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      name.endsWith(".docx");
    const isDoc = mime === "application/msword" || name.endsWith(".doc");

    let raw = "";

    if (isPdf) {
      let text = "";
      try {
        text = (await extractPdfText(data.base64)).trim();
      } catch (e) {
        console.error("[resume] pdf extract failed:", e);
      }
      if (text.length >= 200) {
        raw = await fromText(text);
      } else {
        // Scanned / image-only PDF — send the document itself down the vision path.
        try {
          raw = await callGateway(
            "This resume is a scanned document. Read it visually and return the JSON.",
            undefined,
            [{ mime: "application/pdf", b64: data.base64, name: data.fileName }],
          );
        } catch (e) {
          console.error("[resume] pdf vision failed:", e);
          if (text.length >= 30) raw = await fromText(text);
        }
        if (!raw.trim() && text.length < 30) throw new Error(UNREADABLE);
      }
    } else if (isImage) {
      raw = await callGateway("Parse this resume image and return the JSON.", [
        { mime: data.mimeType, b64: data.base64 },
      ]);
    } else if (isDocx) {
      let text = "";
      try {
        text = (await extractDocxText(data.base64)).trim();
      } catch (e) {
        console.error("[resume] docx extract failed:", e);
      }
      if (text.length < 30) throw new Error(UNREADABLE);
      raw = await fromText(text);
    } else if (isDoc) {
      throw new Error("Old .doc files aren't supported. Please upload a PDF or DOCX instead.");
    } else {
      throw new Error("Unsupported file. Please upload a PDF, DOCX or image (JPG/PNG).");
    }

    if (!raw.trim()) throw new Error(UNREADABLE);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      try {
        parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
      } catch {
        throw new Error(UNREADABLE);
      }
    }

    const result = ParsedResume.parse(parsed);
    const hasAnything =
      !!(result.full_name || result.email || result.mobile || result.headline || result.city) ||
      (result.skills?.length ?? 0) > 0 ||
      (result.experiences?.length ?? 0) > 0 ||
      (result.education?.length ?? 0) > 0;

    if (!hasAnything) {
      throw new Error(UNREADABLE);
    }
    return result;
  });
