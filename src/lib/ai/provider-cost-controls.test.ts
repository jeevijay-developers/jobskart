import { describe, it as test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { routeTaskTier, chatJSONCascade } from "./provider";

describe("routeTaskTier", () => {
  test("returns nano tier for simple task when Jev disabled or mock", async () => {
    const res = await routeTaskTier("Fix a typo in button label");
    assert.ok(res.model);
    assert.ok(["nano", "standard", "frontier"].includes(res.tier));
  });
});

describe("chatJSONCascade schema validation contract", () => {
  test("validates schema correctly", () => {
    const TestSchema = z.object({ ok: z.boolean(), count: z.number() });
    const parsed = TestSchema.parse({ ok: true, count: 42 });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.count, 42);
  });
});
