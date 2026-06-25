import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const inputSchema = z.object({
  fileName: z.string().min(1),
  // Base64-encoded file contents (no data: prefix)
  base64: z.string().min(20),
  // application/pdf | application/vnd.openxmlformats-officedocument.wordprocessingml.document
  mimeType: z.string().min(3),
});

// Coerce nullable/missing strings to "" so the parser tolerates partial AI output.
const nstr = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (v ?? "").toString());
const nstrOpt = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (v == null || v === "" ? null : String(v)));
const nyear = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (v == null || v === "") return null;
    const n = typeof v === "number" ? v : parseInt(String(v).replace(/\D/g, ""), 10);
    return Number.isFinite(n) && n >= 1950 && n <= 2099 ? n : null;
  });
const nbool = z
  .union([z.boolean(), z.string(), z.null(), z.undefined()])
  .transform((v) => v === true || v === "true");

const ParsedResume = z.object({
  full_name: nstrOpt,
  email: nstrOpt,
  mobile: nstrOpt,
  headline: nstrOpt,
  city: nstrOpt,
  years_experience: z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((v) => {
      if (v == null || v === "") return null;
      const n = typeof v === "number" ? v : parseInt(String(v), 10);
      return Number.isFinite(n) && n >= 0 && n <= 60 ? n : null;
    }),
  skills: z.array(z.string()).max(40).catch([]).default([]),
  experiences: z
    .array(
      z.object({
        job_title: nstr,
        company_name: nstr,
        start_date: nstrOpt,
        end_date: nstrOpt,
        is_current: nbool,
        description: nstr,
      }),
    )
    .max(20)
    .catch([])
    .default([]),
  education: z
    .array(
      z.object({
        level: nstr,
        board_or_university: nstr,
        institute: nstr,
        year_of_passing: nyear,
        marks: nstr,
      }),
    )
    .max(10)
    .catch([])
    .default([]),
});

export type ParsedResumePayload = z.infer<typeof ParsedResume>;

const SYSTEM_PROMPT = `You extract structured candidate data from resumes. Reply with ONLY a JSON object matching this schema (no prose, no markdown fences):
{
  "full_name": string | null,
  "email": string | null,
  "mobile": string | null,         // 10 digits (Indian) if available, no country code
  "headline": string | null,       // one-line professional tagline
  "city": string | null,           // current city
  "years_experience": number | null,
  "skills": string[],              // 8-25 concise skill keywords
  "experiences": [{
    "job_title": string, "company_name": string,
    "start_date": "YYYY-MM-DD" | null, "end_date": "YYYY-MM-DD" | null,
    "is_current": boolean, "description": string
  }],
  "education": [{
    "level": "10th" | "12th" | "Diploma" | "Graduate" | "Post Graduate" | "PhD" | "Other",
    "board_or_university": string, "institute": string,
    "year_of_passing": number | null, "marks": string
  }]
}
If a field is unknown, use null or an empty array. Never invent values.`;

export const parseResume = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI not configured.");

    const dataUrl = `data:${data.mimeType};base64,${data.base64}`;

    const isImage = data.mimeType.startsWith("image/");
    const filePart = isImage
      ? { type: "image_url" as const, image_url: { url: dataUrl } }
      : { type: "file" as const, file: { filename: data.fileName, file_data: dataUrl } };

    const body = {
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Parse this resume and return the JSON." },
            filePart,
          ],
        },
      ],
      response_format: { type: "json_object" as const },
    };

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429) throw new Error("Too many requests. Try again in a minute.");
    if (res.status === 402) throw new Error("AI credits exhausted. Add credits in your workspace.");
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Resume parse failed (${res.status}). ${text.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = json.choices?.[0]?.message?.content ?? "{}";

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Sometimes the model wraps in code fences — strip them
      const cleaned = raw.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(cleaned);
    }

    return ParsedResume.parse(parsed);
  });
