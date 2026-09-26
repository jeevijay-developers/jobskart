// Single AI adapter. No other file may contain a provider URL or model name.
import type { ZodType } from "zod";

export type ChatImage = { mime: string; b64: string };

export type ChatFile = { mime: string; b64: string; name?: string };

export type ChatArgs = {
  system?: string;
  user: string;
  images?: ChatImage[];
  /** Documents (e.g. PDFs) passed to the model natively. */
  files?: ChatFile[];
  temperature?: number;
  json?: boolean;
  maxTokens?: number;
};

/** Default output cap when a caller doesn't specify one. Some providers
 *  (e.g. OpenRouter) pre-reserve credit against a model's full max-output
 *  window when max_tokens is omitted, which can 402 an account that has
 *  plenty of credit for a normal reply but not for a 60k+-token worst case. */
const DEFAULT_MAX_TOKENS = 4096;

const LOVABLE_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_JEV_MODEL = "~typesafe/jev-latest";

function cfg() {
  return {
    provider: process.env.AI_PROVIDER ?? "lovable",
    model: process.env.AI_MODEL ?? "google/gemini-3.6-flash",
  };
}

function mapError(status: number, body: string): Error {
  if (status === 429) return new Error("Too many requests. Try again in a minute.");
  if (status === 402) return new Error("AI credits exhausted. Add credits in your workspace.");
  return new Error(`AI request failed (${status}). ${body.slice(0, 200)}`);
}

/** OpenAI-compatible chat completions (Lovable gateway, OpenAI, and OpenRouter). */
async function chatOpenAICompatible(
  url: string,
  headers: Record<string, string>,
  model: string,
  args: ChatArgs,
): Promise<string> {
  const isOpenRouter = url.includes("openrouter.ai");
  const useFloor = process.env.OPENROUTER_USE_FLOOR !== "false";
  // :floor tells OpenRouter to select the lowest-priced provider for the requested model
  const effectiveModel =
    isOpenRouter && useFloor && !model.includes(":") ? `${model}:floor` : model;

  const customHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...headers,
  };

  // Enable prompt caching for supported providers (Anthropic / OpenRouter)
  if (isOpenRouter || url.includes("anthropic.com")) {
    customHeaders["anthropic-beta"] = "prompt-caching-2024-07-31";
  }

  const hasAttachments = !!(args.images?.length || args.files?.length);
  const userContent: unknown = hasAttachments
    ? [
        { type: "text", text: args.user },
        ...(args.images ?? []).map((img) => ({
          type: "image_url",
          image_url: { url: `data:${img.mime};base64,${img.b64}` },
        })),
        ...(args.files ?? []).map((f) => ({
          type: "file",
          file: {
            filename: f.name ?? "document",
            file_data: `data:${f.mime};base64,${f.b64}`,
          },
        })),
      ]
    : args.user;

  const messages: Array<Record<string, unknown>> = [];
  if (args.system) messages.push({ role: "system", content: args.system });
  messages.push({ role: "user", content: userContent });

  const payload: Record<string, unknown> = {
    model: effectiveModel,
    messages,
    max_tokens: args.maxTokens ?? DEFAULT_MAX_TOKENS,
    ...(args.temperature != null ? { temperature: args.temperature } : {}),
    ...(args.json ? { response_format: { type: "json_object" as const } } : {}),
  };

  // OpenRouter specific cost-optimization parameters
  if (isOpenRouter) {
    payload.provider = {
      sort: "price",
      allow_fallbacks: true,
    };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: customHeaders,
    body: JSON.stringify(payload),
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
  for (const f of args.files ?? []) {
    parts.push({ inline_data: { mime_type: f.mime, data: f.b64 } });
  }
  const res = await fetch(`${GEMINI_BASE}/${id}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      ...(args.system ? { systemInstruction: { parts: [{ text: args.system }] } } : {}),
      generationConfig: {
        maxOutputTokens: args.maxTokens ?? DEFAULT_MAX_TOKENS,
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

export async function chatWithModel(model: string, args: ChatArgs): Promise<string> {
  const { provider } = cfg();

  if (provider === "gemini") return chatGemini(model, args);

  if (provider === "openai") {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("AI not configured.");
    return chatOpenAICompatible(OPENAI_URL, { Authorization: `Bearer ${key}` }, model, args);
  }

  if (provider === "openrouter") {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("AI not configured.");
    return chatOpenAICompatible(OPENROUTER_URL, { Authorization: `Bearer ${key}` }, model, args);
  }

  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("AI not configured.");
  return chatOpenAICompatible(LOVABLE_URL, { "Lovable-API-Key": key }, model, args);
}

export async function chat(args: ChatArgs): Promise<string> {
  const { model } = cfg();
  return chatWithModel(model, args);
}

export async function chatJSON<T>(args: ChatArgs, schema: ZodType<T>): Promise<T> {
  const raw = await chat({
    ...args,
    json: true,
    system: (args.system ?? "") + "\nRespond with JSON only. No markdown fences, no preamble.",
  });
  const cleaned = raw.replace(/```json|```/g, "").trim();
  return schema.parse(JSON.parse(cleaned || "{}"));
}

/**
 * Strategy 3: Cascade pattern — Try cheap model first, validate against Zod schema,
 * and escalate to the frontier model only on validation failure or error.
 */
export async function chatJSONCascade<T>(
  args: ChatArgs,
  schema: ZodType<T>,
  opts: { cheapModel?: string; frontierModel?: string } = {},
): Promise<T> {
  const cheapModel = opts.cheapModel || process.env.AI_CHEAP_MODEL || "google/gemini-2.5-flash";
  const frontierModel = opts.frontierModel || cfg().model;

  if (cheapModel === frontierModel) {
    return chatJSON(args, schema);
  }

  // 1. Try cheap model first
  try {
    const raw = await chatWithModel(cheapModel, {
      ...args,
      json: true,
      system: (args.system ?? "") + "\nRespond with JSON only. No markdown fences, no preamble.",
    });
    const cleaned = raw.replace(/```json|```/g, "").trim();
    return schema.parse(JSON.parse(cleaned || "{}"));
  } catch (cheapErr) {
    console.warn(
      `[AI Cascade] Cheap model (${cheapModel}) validation or execution failed. Escalating to ${frontierModel}...`,
    );
  }

  // 2. Escalate to frontier model
  const rawFrontier = await chatWithModel(frontierModel, {
    ...args,
    json: true,
    system: (args.system ?? "") + "\nRespond with JSON only. No markdown fences, no preamble.",
  });
  const cleanedFrontier = rawFrontier.replace(/```json|```/g, "").trim();
  return schema.parse(JSON.parse(cleanedFrontier || "{}"));
}

export type TaskTier = "nano" | "standard" | "frontier";

/**
 * Strategy 1: Dynamic task-complexity router using Jev decide().
 * Classifies task complexity in ~100ms for ~$0.00004 to choose the optimal model.
 */
export async function routeTaskTier(
  taskHint: string,
  defaultModel?: string,
): Promise<{ tier: TaskTier; model: string }> {
  const fallbackModel = defaultModel || cfg().model;
  const cheapModel = process.env.AI_CHEAP_MODEL || "google/gemini-2.5-flash";

  if (!isJevEnabled()) {
    return { tier: "standard", model: fallbackModel };
  }

  try {
    const decision = await decide({
      state: { task: taskHint.slice(0, 1000) },
      questions: {
        complexity: {
          type: "choice",
          instructions: "Classify the complexity of this task into one category",
          criteria: {
            simple: "Straightforward extraction, formatting, simple lookup, single field check",
            complex: "Deep reasoning, synthesis, multi-step generation, complex qualitative evaluation",
          },
        },
      },
    });

    const choice = (decision.answers.complexity as { choice?: string })?.choice;
    if (choice === "simple") {
      return { tier: "nano", model: cheapModel };
    }
    return { tier: "frontier", model: fallbackModel };
  } catch {
    return { tier: "standard", model: fallbackModel };
  }
}

export type DecideQuestion = {
  type: "noul" | "choice" | "score";
  instructions: string;
  criteria?: Record<string, string | null> | string[];
};

export type DecideArgs = {
  state: unknown;
  questions: Record<string, DecideQuestion>;
};

export type DecideNoul = { type: "noul"; noul: number };
export type DecideChoice = {
  type: "choice";
  choice: string;
  probabilities?: Record<string, number>;
  confidence?: number;
};
export type DecideScore = {
  type: "score";
  score: number;
  probabilities?: Record<string, number>;
  confidence?: number;
};
export type DecideAnswer = DecideNoul | DecideChoice | DecideScore;

export type DecideResult = {
  model: string;
  answers: Record<string, DecideAnswer>;
};

/** Opt-in Jev gate. Off unless JEV_ENABLED=true and OPENROUTER_API_KEY is set. */
export function isJevEnabled(): boolean {
  return process.env.JEV_ENABLED === "true" && !!process.env.OPENROUTER_API_KEY;
}

export async function decide(args: DecideArgs): Promise<DecideResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("AI not configured.");
  const model = process.env.JEV_MODEL || DEFAULT_JEV_MODEL;
  const res = await fetch(OPENROUTER_DECISIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      state: args.state,
      questions: args.questions,
    }),
  });
  if (!res.ok) throw mapError(res.status, await res.text().catch(() => ""));
  const json = (await res.json()) as {
    model?: string;
    answers?: Record<string, DecideAnswer>;
  };
  if (!json.answers || typeof json.answers !== "object") {
    throw new Error("AI request failed (empty Jev answers).");
  }
  return { model: json.model ?? model, answers: json.answers };
}
