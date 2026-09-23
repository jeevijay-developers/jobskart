import { describe, it as test } from "node:test";
import assert from "node:assert/strict";
import {
  buildResumeGateQuestion,
  isLikelyResume,
  parseResumeGateAnswers,
  RESUME_NON_RESUME_MESSAGE,
  RESUME_REJECT_THRESHOLD,
  type ResumeGateAnswers,
} from "./jev-resume-gate";

function noul(n: number) {
  return { type: "noul" as const, noul: n };
}

describe("buildResumeGateQuestion", () => {
  test("creates is_resume question of type noul", () => {
    const q = buildResumeGateQuestion();
    assert.equal(q.is_resume?.type, "noul");
    assert.ok(q.is_resume?.instructions.includes("resume"));
  });
});

describe("parseResumeGateAnswers", () => {
  test("parses valid noul answer", () => {
    const res = parseResumeGateAnswers({ is_resume: { noul: 0.85 } });
    assert.equal(res.is_resume?.noul, 0.85);
  });

  test("returns empty object on empty or invalid answer", () => {
    assert.deepEqual(parseResumeGateAnswers(null), {});
    assert.deepEqual(parseResumeGateAnswers({}), {});
    assert.deepEqual(parseResumeGateAnswers({ is_resume: "not an object" }), {});
    assert.deepEqual(parseResumeGateAnswers({ is_resume: { noul: "string" } }), {});
  });
});

describe("isLikelyResume", () => {
  test("passes when noul is at or above threshold", () => {
    assert.equal(isLikelyResume({ is_resume: noul(0.9) }), true);
    assert.equal(isLikelyResume({ is_resume: noul(RESUME_REJECT_THRESHOLD) }), true);
    assert.equal(isLikelyResume({ is_resume: noul(0.5) }), true);
  });

  test("rejects when noul is strictly below threshold (obvious non-resume)", () => {
    assert.equal(isLikelyResume({ is_resume: noul(0.15) }), false);
    assert.equal(isLikelyResume({ is_resume: noul(0.02) }), false);
    assert.equal(isLikelyResume({ is_resume: noul(0.0) }), false);
  });

  test("fails open (passes) when answer is missing or malformed to not block user", () => {
    assert.equal(isLikelyResume({}), true);
    assert.equal(isLikelyResume({ is_resume: undefined }), true);
  });
});
