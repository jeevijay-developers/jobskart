import { describe, it as test } from "node:test";
import assert from "node:assert/strict";
import {
  GATE_HONESTY_REASON,
  buildShortlistQuestions,
  parseGateAnswers,
  reasonsFromGate,
  routeFromAnswers,
  scoreFromGate,
  scoreRowFromGate,
  type GateAnswers,
} from "./jev-shortlist-gate.ts";

function expect(actual: any) {
  return {
    toBe: (expected: any) => assert.equal(actual, expected),
    toEqual: (expected: any) => assert.deepEqual(actual, expected),
    toBeUndefined: () => assert.equal(actual, undefined),
    toBeGreaterThanOrEqual: (expected: number) => assert.ok(actual >= expected),
    toBeLessThanOrEqual: (expected: number) => assert.ok(actual <= expected),
  };
}

function noul(n: number): { type: "noul"; noul: number } {
  return { type: "noul", noul: n };
}

describe("buildShortlistQuestions", () => {
  test("omits location when the job has no city", () => {
    const q = buildShortlistQuestions(false);
    expect(q.skills_ok?.type).toBe("noul");
    expect(q.experience_ok?.type).toBe("noul");
    expect(q.location_ok).toBeUndefined();
  });

  test("includes location when the job has a city", () => {
    expect(buildShortlistQuestions(true).location_ok?.type).toBe("noul");
  });
});

describe("routeFromAnswers", () => {
  test("keep when skills, experience, and location are high", () => {
    const answers: GateAnswers = {
      skills_ok: noul(0.9),
      experience_ok: noul(0.88),
      location_ok: noul(0.75),
    };
    expect(routeFromAnswers(answers, { locationSkipped: false })).toBe("keep");
  });

  test("keep when location is skipped and skills/experience are high", () => {
    const answers: GateAnswers = {
      skills_ok: noul(0.95),
      experience_ok: noul(0.95),
    };
    expect(routeFromAnswers(answers, { locationSkipped: true })).toBe("keep");
  });

  test("drop when skills noul is at or below 0.15", () => {
    const answers: GateAnswers = {
      skills_ok: noul(0.15),
      experience_ok: noul(0.99),
      location_ok: noul(0.99),
    };
    expect(routeFromAnswers(answers, { locationSkipped: false })).toBe("drop");
  });

  test("drop when experience noul is at or below 0.15", () => {
    const answers: GateAnswers = {
      skills_ok: noul(0.99),
      experience_ok: noul(0.1),
      location_ok: noul(0.99),
    };
    expect(routeFromAnswers(answers, { locationSkipped: false })).toBe("drop");
  });

  test("gemini when location fails but skills and experience are keep-range", () => {
    const answers: GateAnswers = {
      skills_ok: noul(0.9),
      experience_ok: noul(0.9),
      location_ok: noul(0.2),
    };
    expect(routeFromAnswers(answers, { locationSkipped: false })).toBe("gemini");
  });

  test("gemini on missing noul (parse failure)", () => {
    expect(routeFromAnswers({ skills_ok: noul(0.9) }, { locationSkipped: true })).toBe("gemini");
  });

  test("parseGateAnswers ignores malformed payloads", () => {
    expect(parseGateAnswers({ skills_ok: { type: "noul", noul: "nope" } }).skills_ok).toBeUndefined();
    expect(parseGateAnswers({ skills_ok: noul(0.4) }).skills_ok?.noul).toBe(0.4);
  });

  test("gemini in the uncertain middle", () => {
    const answers: GateAnswers = {
      skills_ok: noul(0.5),
      experience_ok: noul(0.5),
      location_ok: noul(0.5),
    };
    expect(routeFromAnswers(answers, { locationSkipped: false })).toBe("gemini");
  });
});

describe("scoreFromGate clamps", () => {
  test("keep scores sit in 80–92", () => {
    const answers: GateAnswers = { skills_ok: noul(1), experience_ok: noul(1) };
    const score = scoreFromGate("keep", answers);
    expect(score).toBeGreaterThanOrEqual(80);
    expect(score).toBeLessThanOrEqual(92);
    expect(score).toBe(90);
  });

  test("keep at the threshold maps near the bottom of the band", () => {
    const answers: GateAnswers = { skills_ok: noul(0.85), experience_ok: noul(0.85) };
    expect(scoreFromGate("keep", answers)).toBe(89);
  });

  test("drop scores sit in 5–35", () => {
    expect(scoreFromGate("drop", { skills_ok: noul(0) })).toBe(8);
    expect(scoreFromGate("drop", { skills_ok: noul(0.15) })).toBe(12);
  });
});

describe("reasonsFromGate", () => {
  test("never includes raw noul numbers and always discloses the gate", () => {
    const reasons = reasonsFromGate(
      "drop",
      { skills_ok: noul(0.05), experience_ok: noul(0.9) },
      { locationSkipped: true },
    );
    expect(reasons.some((r) => r.includes("0.05"))).toBe(false);
    expect(reasons.at(-1)).toBe(GATE_HONESTY_REASON);
  });
});

describe("scoreRowFromGate", () => {
  test("gemini rows do not invent a score", () => {
    const row = scoreRowFromGate(
      { skills_ok: noul(0.5), experience_ok: noul(0.5) },
      { locationSkipped: true },
    );
    expect(row.route).toBe("gemini");
    expect(row.score).toBe(0);
    expect(row.reasons).toEqual([]);
  });
});
