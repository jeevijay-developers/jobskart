// Single AI adapter. No other file may contain a provider URL or model name.
import type { ZodType } from "zod";

export type ChatImage = { mime: string; b64: string };

export type ChatArgs = {
  system?: string;
  user: string;
  images?: ChatImage[];
  temperature?: number;
  json?: boolean;
};

const LOVABLE_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function cfg() {
  return {
    provider: process.env.AI_PROVIDER ?? "lovable",
    model: process.env.AI_MODEL ?? "google/gemini-2.5-flash",
  };
}

function mapError(status: number, body: string): Error {
  if (status === 429) return new Error("Too many requests. Try again in a minute.");
  if (status === 402) return new Error("AI credits exhausted. Add credits in your workspace.");
  return new Error(`AI request failed (${status}). ${body.slice(0, 200)}`);
}

/** OpenAI-compatible chat completions (Lovable gateway + OpenAI). */
async function chatOpenAICompatible(
  url: string,
  headers: Record<string, string>,
  model: string,
  args: ChatArgs,
): Promise<string> {
  const userContent: unknown = args.images?.length
    ? [
        { type: "text", text: args.user },
        ...args.images.map((img) => ({
          type: "image_url",
          image_url: { url: `data:${img.mime};base64,${img.b64}` },
        })),
      ]
    : args.user;

  const messages: Array<Record<string, unknown>> = [];
  if (args.system) messages.push({ role: "system", content: args.system });
  messages.push({ role: "user", content: userContent });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      model,
      messages,
      ...(args.temperature != null ? { temperature: args.temperature } : {}),
      ...(args.json ? { response_format: { type: "json_object" as const } } : {}),
    }),
  });

  if (!res.ok) throw mapError(res.status, await res.text().catch(() => ""));
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content ?? "";
}

async function chatGemini(model: string, args: ChatArgs): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("AI not configured.");
  const id = model.replace(/^google\//, "");
  const parts: Array<Record<string, unknown>> = [{ text: args.user }];
  for (const img of args.images ?? []) {
    parts.push({ inline_data: { mime_type: img.mime, data: img.b64 } });
  }
  const res = await fetch(`${GEMINI_BASE}/${id}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      ...(args.system ? { systemInstruction: { parts: [{ text: args.system }] } } : {}),
      generationConfig: {
        ...(args.temperature != null ? { temperature: args.temperature } : {}),
        ...(args.json ? { responseMimeType: "application/json" } : {}),
      },
    }),
  });
  if (!res.ok) throw mapError(res.status, await res.text().catch(() => ""));
  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
}

export async function chat(args: ChatArgs): Promise<string> {
  const { provider, model } = cfg();

  if (provider === "gemini") return chatGemini(model, args);

  if (provider === "openai") {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("AI not configured.");
    return chatOpenAICompatible(OPENAI_URL, { Authorization: `Bearer ${key}` }, model, args);
  }

  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("AI not configured.");
  return chatOpenAICompatible(LOVABLE_URL, { "Lovable-API-Key": key }, model, args);
}

export async function chatJSON<T>(args: ChatArgs, schema: ZodType<T>): Promise<T> {
  const raw = await chat({
    ...args,
    json: true,
    system:
      (args.system ?? "") +
      "\nRespond with JSON only. No markdown fences, no preamble.",
  });
  const cleaned = raw.replace(/```json|```/g, "").trim();
  return schema.parse(JSON.parse(cleaned || "{}"));
}
