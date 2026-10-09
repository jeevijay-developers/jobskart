// Unit tests invoking the backfill route's POST handler directly (no server, no network).
// `createFileRoute(path)(options)` just constructs a plain Route object synchronously
// (see @tanstack/router-core's `createRoute`, which does `this.options = options`), so
// `Route.options.server.handlers.POST` is callable here with a hand-built Request.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Route } from "./embeddings-backfill.ts";

// `server.handlers` is typed as a union that also allows a factory function; the route file
// always passes a plain object, so this cast reflects what is actually there at runtime.
const handlers = Route.options.server!.handlers as unknown as {
  POST: (args: { request: Request }) => Promise<Response>;
};
const handler = handlers.POST;

const ENV_KEYS = [
  "EMBEDDINGS_BACKFILL_SECRET",
  "AI_PROVIDER",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function req(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/public/embeddings-backfill", {
    method: "POST",
    headers,
  });
}

describe("POST /api/public/embeddings-backfill", () => {
  it("503s when EMBEDDINGS_BACKFILL_SECRET is unset", async () => {
    const res = await handler({ request: req() });
    assert.equal(res.status, 503);
  });

  it("403s on a missing or wrong secret header", async () => {
    process.env.EMBEDDINGS_BACKFILL_SECRET = "s3cret";
    const missing = await handler({ request: req() });
    assert.equal(missing.status, 403);
    const wrong = await handler({ request: req({ "x-backfill-secret": "nope" }) });
    assert.equal(wrong.status, 403);
  });

  it("500s with a generic body (not the real error) when embeddings are unsupported, but logs the real error", async () => {
    process.env.EMBEDDINGS_BACKFILL_SECRET = "s3cret";
    // AI_PROVIDER unset/lovable with no GEMINI_API_KEY => embeddingModelId() === "unsupported"
    // => backfillEmbeddings() throws "Embeddings are not configured for this AI_PROVIDER."
    const originalError = console.error;
    const errorCalls: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      errorCalls.push(args);
    };
    try {
      const res = await handler({ request: req({ "x-backfill-secret": "s3cret" }) });
      assert.equal(res.status, 500);
      const body = await res.text();
      assert.ok(!body.includes("AI_PROVIDER"), "generic body must not leak the thrown error text");
      assert.ok(
        !body.includes("not configured for"),
        "generic body must not leak the thrown error text",
      );
      assert.ok(
        errorCalls.some((args) =>
          args.some((a) => a instanceof Error && /AI_PROVIDER/.test(a.message)),
        ),
        "the real error must still reach console.error",
      );
    } finally {
      console.error = originalError;
    }
  });
});
