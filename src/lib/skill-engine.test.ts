import { describe, it as test } from "node:test";
import assert from "node:assert/strict";
import { getRecommendedSkills } from "./skill-engine.ts";

describe("getRecommendedSkills", () => {
  test("curated role (tier 1) returns its skills as core", () => {
    const r = getRecommendedSkills("Sales Executive");
    assert.ok(r.core.includes("Lead Generation"));
    assert.ok(r.core.includes("Cold Calling"));
  });

  test("uncurated title falls back to tier-2 keyword family", () => {
    const r = getRecommendedSkills("Bike Delivery Rider");
    assert.ok(r.core.includes("Route Planning") || r.recommended.includes("Route Planning"));
  });

  test("currentSkills are excluded from both lists", () => {
    const r = getRecommendedSkills("Sales Executive", undefined, ["Lead Generation"]);
    assert.ok(!r.core.includes("Lead Generation"));
    assert.ok(!r.recommended.includes("Lead Generation"));
  });

  test("unknown title with no category falls back to generic defaults", () => {
    const r = getRecommendedSkills("Zzxqy 99");
    assert.ok(r.core.length + r.recommended.length > 0);
  });

  test("empty title returns empty lists", () => {
    const r = getRecommendedSkills("");
    assert.deepEqual(r, { core: [], recommended: [] });
  });
});
