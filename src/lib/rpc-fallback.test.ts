import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rpcWithFallback } from "./rpc-fallback.ts";

type R = { data: string[] | null; error: { message: string } | null };

describe("rpcWithFallback", () => {
  it("returns the primary result and never calls the fallback when primary succeeds", async () => {
    let fallbackCalls = 0;
    const result = await rpcWithFallback<R>(
      async () => ({ data: ["routed"], error: null }),
      async () => {
        fallbackCalls++;
        return { data: ["v1"], error: null };
      },
    );
    assert.deepEqual(result.data, ["routed"]);
    assert.equal(fallbackCalls, 0);
  });

  it("returns the fallback result and reports the primary error message when primary fails", async () => {
    const reported: string[] = [];
    const result = await rpcWithFallback<R>(
      async () => ({
        data: null,
        error: { message: "function recommend_jobs_routed does not exist" },
      }),
      async () => ({ data: ["v1"], error: null }),
      (m) => reported.push(m),
    );
    assert.deepEqual(result.data, ["v1"]);
    assert.deepEqual(reported, ["function recommend_jobs_routed does not exist"]);
  });

  it("surfaces the fallback's error when both fail", async () => {
    const result = await rpcWithFallback<R>(
      async () => ({ data: null, error: { message: "primary down" } }),
      async () => ({ data: null, error: { message: "not_authenticated" } }),
    );
    assert.equal(result.error?.message, "not_authenticated");
  });

  it("falls back when primary rejects (e.g. network failure) and reports the thrown message", async () => {
    const reported: string[] = [];
    const result = await rpcWithFallback<R>(
      async () => {
        throw new TypeError("Failed to fetch");
      },
      async () => ({ data: ["v1"], error: null }),
      (m) => reported.push(m),
    );
    assert.deepEqual(result.data, ["v1"]);
    assert.deepEqual(reported, ["Failed to fetch"]);
  });

  it("falls back when primary throws synchronously", async () => {
    const result = await rpcWithFallback<R>(
      () => {
        throw new Error("sync boom");
      },
      async () => ({ data: ["v1"], error: null }),
    );
    assert.deepEqual(result.data, ["v1"]);
  });

  it("propagates a rejection from the fallback (nothing left to fall back to)", async () => {
    await assert.rejects(
      rpcWithFallback<R>(
        async () => ({ data: null, error: { message: "primary down" } }),
        async () => {
          throw new Error("fallback down");
        },
      ),
      /fallback down/,
    );
  });
});
