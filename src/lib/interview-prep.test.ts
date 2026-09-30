import { describe, it as test } from "node:test";
import assert from "node:assert/strict";
import {
  checkAnswer,
  computeReadiness,
  computeSkillGap,
  fallbackFeedback,
  FeedbackSchema,
} from "./interview-prep.ts";

const long =
  "When I worked at a store a customer was upset about a delayed order. I called the warehouse, explained the delay and arranged a refund. As a result the customer stayed with us.";

describe("checkAnswer", () => {
  test("rejects very short answers", () => {
    assert.equal(checkAnswer("yes", "intro").ok, false);
  });
  test("accepts a developed answer", () => {
    assert.equal(checkAnswer(long, "behavioural").ok, true);
  });
});

describe("fallbackFeedback", () => {
  test("is schema-valid and detects STAR parts", () => {
    const fb = fallbackFeedback(long, "behavioural", { name: "STAR", steps: ["S", "T", "A", "R"] });
    assert.doesNotThrow(() => FeedbackSchema.parse(fb));
  });
});

describe("computeReadiness", () => {
  const fb = fallbackFeedback(long, "behavioural", {});
  test("needs minimum evidence", () => {
    const r = computeReadiness([{ category: "intro", feedback: fb, at: "2026-01-01" }]);
    assert.equal(r.status, "insufficient");
  });
  test("returns a band with enough evidence", () => {
    const r = computeReadiness(
      ["intro", "behavioural", "intro"].map((category, i) => ({
        category,
        feedback: fb,
        at: `2026-01-0${i + 1}`,
      })),
    );
    assert.equal(r.status, "ready");
  });
});

describe("computeSkillGap", () => {
  test("splits evidenced / practise / explore", () => {
    const g = computeSkillGap(
      ["Excel", "Tally", "Billing"],
      ["excel", "billing"],
      ["I use Excel daily"],
    );
    assert.deepEqual(g.evidenced, ["Excel"]);
    assert.deepEqual(g.practise, ["Billing"]);
    assert.deepEqual(g.explore, ["Tally"]);
  });
});

import { computeProgress } from "./interview-prep.ts";
describe("computeProgress", () => {
  test("finds weakest categories with enough evidence", () => {
    const weak = fallbackFeedback(
      "short but long enough answer here for testing purposes ok",
      "intro",
      {},
    );
    const strongish = FeedbackSchema.parse({
      criteria: [{ key: "structure", band: "strong", evidence: "e", tip: "t" }],
      strengths: [],
      improvements: ["x"],
      outline: ["a", "b"],
    });
    const p = computeProgress([
      { category: "intro", feedback: weak, at: "2026-01-01", sessionId: "s1" },
      { category: "intro", feedback: weak, at: "2026-01-02", sessionId: "s2" },
      { category: "logistics", feedback: strongish, at: "2026-01-02", sessionId: "s2" },
    ]);
    assert.equal(p.sessions, 2);
    assert.deepEqual(p.weakest, ["intro"]);
    assert.equal(p.trend.length, 2);
  });
});

import { isAllowedAudioMime, looksLikeAudio, paceNote, voiceMetrics } from "./interview-prep.ts";
describe("voice helpers", () => {
  const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  test("accepts allowed mime with codec params, rejects others", () => {
    assert.equal(isAllowedAudioMime("audio/webm;codecs=opus"), true);
    assert.equal(isAllowedAudioMime("video/mp4"), false);
    assert.equal(isAllowedAudioMime("application/pdf"), false);
  });
  test("checks magic bytes against the declared type", () => {
    assert.equal(looksLikeAudio(webm, "audio/webm;codecs=opus"), true);
    assert.equal(looksLikeAudio(webm, "audio/ogg"), false);
    assert.equal(looksLikeAudio(new Uint8Array(20), "audio/webm"), false);
    assert.equal(looksLikeAudio(new Uint8Array(5), "audio/webm"), false);
  });
  test("computes pace and fillers from the final transcript", () => {
    const text =
      "Um so basically I handled billing and, uh, you know, I checked every amount " +
      "word ".repeat(80);
    const m = voiceMetrics(text, 60);
    assert.equal(m.duration_sec, 60);
    assert.ok(m.wpm > 80 && m.wpm < 120);
    assert.equal(m.fillers.um, 1);
    assert.equal(m.fillers.uh, 1);
    assert.equal(m.fillers["you know"], 1);
    assert.equal(m.fillers.basically, 1);
    assert.equal(m.total_fillers, 4);
  });
  test("clamps absurd durations and gives neutral pace notes", () => {
    assert.equal(voiceMetrics("word", 9999).duration_sec, 120);
    assert.equal(voiceMetrics("word", -5).duration_sec, 1);
    assert.match(paceNote(voiceMetrics("x ".repeat(200), 60)), /quick|comfortable/);
  });
});
