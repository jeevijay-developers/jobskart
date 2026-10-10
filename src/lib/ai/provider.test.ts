import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { embed, embeddingModelId } from "./provider.ts";

const KEYS = ["AI_PROVIDER", "GEMINI_API_KEY", "OPENAI_API_KEY"] as const;
let saved: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];

function stubFetch(response: { status?: number; body?: unknown }) {
  calls = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const status = response.status ?? 200;
    return new Response(
      typeof response.body === "string" ? response.body : JSON.stringify(response.body ?? {}),
      {
        status,
      },
    );
  }) as typeof fetch;
}

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  globalThis.fetch = realFetch;
});

const GEMINI_OK = { embedding: { values: [0.1, 0.2, 0.3] } };
const OPENAI_OK = { data: [{ embedding: [0.4, 0.5] }] };
const bodyOf = (c: Call) => JSON.parse(String(c.init.body));

describe("embed() behavior (characterization)", () => {
  it("gemini provider + key -> one call to gemini-embedding-001:embedContent with 1536 dims", async () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "gk";
    stubFetch({ body: GEMINI_OK });
    const out = await embed("hello");
    assert.deepEqual(out, [0.1, 0.2, 0.3]);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.includes("gemini-embedding-001:embedContent"));
    assert.equal(bodyOf(calls[0]).outputDimensionality, 1536);
    assert.equal(bodyOf(calls[0]).content.parts[0].text, "hello");
  });

  it("openai provider + key -> OpenAI embeddings endpoint with text-embedding-3-small and bearer auth", async () => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "ok";
    stubFetch({ body: OPENAI_OK });
    const out = await embed("hello");
    assert.deepEqual(out, [0.4, 0.5]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.openai.com/v1/embeddings");
    assert.equal(bodyOf(calls[0]).model, "text-embedding-3-small");
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer ok");
  });

  it("lovable chat provider + GEMINI_API_KEY -> uses Gemini", async () => {
    process.env.AI_PROVIDER = "lovable";
    process.env.GEMINI_API_KEY = "gk";
    stubFetch({ body: GEMINI_OK });
    await embed("hello");
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.includes("gemini-embedding-001:embedContent"));
  });

  it("openai provider with both keys -> OpenAI wins", async () => {
    process.env.AI_PROVIDER = "openai";
    process.env.GEMINI_API_KEY = "gk";
    process.env.OPENAI_API_KEY = "ok";
    stubFetch({ body: OPENAI_OK });
    await embed("hello");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.openai.com/v1/embeddings");
  });

  it("lovable with no keys -> rejects as not supported, without calling fetch", async () => {
    process.env.AI_PROVIDER = "lovable";
    stubFetch({ body: {} });
    await assert.rejects(embed("hello"), /not supported/);
    assert.equal(calls.length, 0);
  });

  it("gemini provider without a key -> AI not configured", async () => {
    process.env.AI_PROVIDER = "gemini";
    stubFetch({ body: {} });
    await assert.rejects(embed("hello"), /AI not configured/);
    assert.equal(calls.length, 0);
  });

  it("maps a 429 to the rate-limit message", async () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "gk";
    stubFetch({ status: 429, body: "slow down" });
    await assert.rejects(embed("hello"), /Too many requests/);
  });

  it("rejects an empty embedding (gemini and openai)", async () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "gk";
    stubFetch({ body: { embedding: { values: [] } } });
    await assert.rejects(embed("hello"), /empty embedding/);

    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "ok";
    stubFetch({ body: { data: [{ embedding: [] }] } });
    await assert.rejects(embed("hello"), /empty embedding/);
  });
});

describe("embeddingModelId mirrors embed()'s backend choice", () => {
  it("gemini provider -> gemini model with fixed dimensions", () => {
    process.env.AI_PROVIDER = "gemini";
    assert.equal(embeddingModelId(), "gemini-embedding-001/1536");
  });

  it("lovable chat provider + GEMINI_API_KEY -> gemini embeddings", () => {
    process.env.AI_PROVIDER = "lovable";
    process.env.GEMINI_API_KEY = "k";
    assert.equal(embeddingModelId(), "gemini-embedding-001/1536");
  });

  it("openai provider wins even when a gemini key exists", () => {
    process.env.AI_PROVIDER = "openai";
    process.env.GEMINI_API_KEY = "k";
    assert.equal(embeddingModelId(), "openai/text-embedding-3-small");
  });

  it("openrouter without a gemini key -> openai embeddings", () => {
    process.env.AI_PROVIDER = "openrouter";
    assert.equal(embeddingModelId(), "openai/text-embedding-3-small");
  });

  it("lovable without any gemini key -> unsupported", () => {
    process.env.AI_PROVIDER = "lovable";
    assert.equal(embeddingModelId(), "unsupported");
  });
});

describe("embeddingModelId agrees with what embed() actually calls", () => {
  const scenarios: Array<{ name: string; env: Record<string, string> }> = [
    { name: "gemini", env: { AI_PROVIDER: "gemini", GEMINI_API_KEY: "gk" } },
    { name: "openai", env: { AI_PROVIDER: "openai", OPENAI_API_KEY: "ok" } },
    { name: "lovable + gemini key", env: { AI_PROVIDER: "lovable", GEMINI_API_KEY: "gk" } },
    { name: "openrouter + gemini key", env: { AI_PROVIDER: "openrouter", GEMINI_API_KEY: "gk" } },
    {
      name: "openai with both keys",
      env: { AI_PROVIDER: "openai", GEMINI_API_KEY: "gk", OPENAI_API_KEY: "ok" },
    },
    { name: "openrouter + openai key", env: { AI_PROVIDER: "openrouter", OPENAI_API_KEY: "ok" } },
  ];

  for (const s of scenarios) {
    it(s.name, async () => {
      Object.assign(process.env, s.env);
      stubFetch({
        body: s.env.AI_PROVIDER === "openai" || !s.env.GEMINI_API_KEY ? OPENAI_OK : GEMINI_OK,
      });
      await embed("hello");
      assert.equal(calls.length, 1);
      const usedGemini = calls[0].url.includes("gemini-embedding-001:embedContent");
      const expected = usedGemini
        ? `gemini-embedding-001/${bodyOf(calls[0]).outputDimensionality}`
        : `openai/${bodyOf(calls[0]).model}`;
      assert.equal(embeddingModelId(), expected);
    });
  }

  it("when embed() is unsupported the id is 'unsupported'", async () => {
    process.env.AI_PROVIDER = "lovable";
    stubFetch({ body: {} });
    await assert.rejects(embed("hello"), /not supported/);
    assert.equal(embeddingModelId(), "unsupported");
  });
});
