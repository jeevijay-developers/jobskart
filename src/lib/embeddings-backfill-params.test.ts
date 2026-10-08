import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkBackfillAuth, parseBackfillParams } from "./embeddings-backfill-params.ts";

describe("parseBackfillParams", () => {
  it("defaults to mode=missing, limit=25", () => {
    assert.deepEqual(parseBackfillParams(new URLSearchParams("")), { mode: "missing", limit: 25 });
  });

  it("accepts mode=refresh", () => {
    assert.equal(parseBackfillParams(new URLSearchParams("mode=refresh")).mode, "refresh");
  });

  it("treats any unknown mode as missing (never escalates cost by accident)", () => {
    assert.equal(parseBackfillParams(new URLSearchParams("mode=all")).mode, "missing");
    assert.equal(parseBackfillParams(new URLSearchParams("mode=REFRESH")).mode, "missing");
  });

  it("clamps limit into 1..50 and ignores garbage", () => {
    assert.equal(parseBackfillParams(new URLSearchParams("limit=500")).limit, 50);
    assert.equal(parseBackfillParams(new URLSearchParams("limit=0")).limit, 1);
    assert.equal(parseBackfillParams(new URLSearchParams("limit=-7")).limit, 1);
    assert.equal(parseBackfillParams(new URLSearchParams("limit=abc")).limit, 25);
    assert.equal(parseBackfillParams(new URLSearchParams("limit=")).limit, 25);
  });
});

describe("checkBackfillAuth", () => {
  const SECRET = "s3cret-value-123";

  it("unset secret => unconfigured (even with a header)", () => {
    assert.equal(checkBackfillAuth(SECRET, undefined), "unconfigured");
    assert.equal(checkBackfillAuth(null, undefined), "unconfigured");
  });

  it("empty-string secret => unconfigured, never authenticates an empty or missing header", () => {
    assert.equal(checkBackfillAuth("", ""), "unconfigured");
    assert.equal(checkBackfillAuth(null, ""), "unconfigured");
    assert.equal(checkBackfillAuth("anything", ""), "unconfigured");
  });

  it("missing header => forbidden", () => {
    assert.equal(checkBackfillAuth(null, SECRET), "forbidden");
  });

  it("empty header => forbidden", () => {
    assert.equal(checkBackfillAuth("", SECRET), "forbidden");
  });

  it("wrong value of the same length => forbidden", () => {
    assert.equal(checkBackfillAuth("x".repeat(SECRET.length), SECRET), "forbidden");
  });

  it("wrong values of different lengths => forbidden without throwing", () => {
    assert.equal(checkBackfillAuth(SECRET.slice(0, -1), SECRET), "forbidden");
    assert.equal(checkBackfillAuth(SECRET + "x", SECRET), "forbidden");
    assert.equal(checkBackfillAuth("a", SECRET), "forbidden");
    assert.equal(checkBackfillAuth("a".repeat(10_000), SECRET), "forbidden");
  });

  it("correct value => ok", () => {
    assert.equal(checkBackfillAuth(SECRET, SECRET), "ok");
  });

  it("is case sensitive and does not trim", () => {
    assert.equal(checkBackfillAuth(SECRET.toUpperCase(), SECRET), "forbidden");
    assert.equal(checkBackfillAuth(` ${SECRET}`, SECRET), "forbidden");
    assert.equal(checkBackfillAuth(`${SECRET} `, SECRET), "forbidden");
  });

  it("handles non-ASCII header values and secrets", () => {
    assert.equal(checkBackfillAuth("गुप्त-कुंजी", SECRET), "forbidden");
    assert.equal(checkBackfillAuth("é".repeat(SECRET.length), SECRET), "forbidden");
    assert.equal(checkBackfillAuth("गुप्त-कुंजी", "गुप्त-कुंजी"), "ok");
    assert.equal(checkBackfillAuth("गुप्त-कुंजी", "गुप्त-कुंजा"), "forbidden");
    // same UTF-16 length, different UTF-8 byte length
    assert.equal(checkBackfillAuth("aé", "ab"), "forbidden");
  });
});
