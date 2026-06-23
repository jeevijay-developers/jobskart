import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const inputSchema = z.object({
  fileName: z.string().min(1),
  // Base64-encoded file contents (no data: prefix)
  base64: z.string().min(20),
  // application/pdf | application/vnd.openxmlformats-officedocument.wordprocessingml.document
  mimeType: z.string().min(3),
});

const ParsedResume = z.object({
  full_name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  mobile: z.string().nullable().optional(),
  headline: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  years_experience: z.number().int().min(0).max(60).nullable().optional(),
  skills: z.array(z.string()).max(40).default([]),
  experiences: z
    .array(
      z.object({
        job_title: z.string().default(""),
        company_name: z.string().default(""),
        start_date: z.string().nullable().optional(),
        end_date: z.string().nullable().optional(),
        is_current: z.boolean().default(false),
        description: z.string().default(""),
      }),
    )
    .max(20)
    .default([]),
  education: z
    .array(
      z.object({
        level: z.string().default(""),
        board_or_university: z.string().default(""),
        institute: z.string().default(""),
        year_of_passing: z.number().int().min(1950).max(2099).nullable().optional(),
        marks: z.string().default(""),
      }),
    )
    .max(10)
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

    const body = {
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Parse this resume and return the JSON." },
            {
              type: "file",
              file: { filename: data.fileName, file_data: dataUrl },
            },
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
