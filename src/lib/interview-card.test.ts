import { describe, it as test } from "node:test";
import assert from "node:assert/strict";
import {
  CARD_CONSENT_POINTS,
  CARD_MAX_TAKES,
  audioExtension,
  canPublish,
  cardAudioPath,
  takesLeft,
} from "./interview-card";

describe("interview card helpers", () => {
  test("keeps every audio file inside the candidate's own folder", () => {
    assert.equal(
      cardAudioPath("cand-1", "card-9", 3, "audio/webm;codecs=opus"),
      "cand-1/card-9/q3.webm",
    );
    assert.equal(cardAudioPath("cand-1", "card-9", 1, "audio/mp4"), "cand-1/card-9/q1.m4a");
  });

  test("maps mime types to extensions, defaulting to webm", () => {
    assert.equal(audioExtension("audio/ogg;codecs=opus"), "ogg");
    assert.equal(audioExtension("audio/mpeg"), "mp3");
    assert.equal(audioExtension("application/octet-stream"), "webm");
  });

  test("needs three included, answered questions to publish", () => {
    const a = (state: "answered" | "pending", include: boolean) => ({ state, include });
    assert.equal(canPublish([a("answered", true), a("answered", true)]), false);
    assert.equal(canPublish([a("answered", true), a("answered", true), a("pending", true)]), false);
    assert.equal(
      canPublish([a("answered", true), a("answered", true), a("answered", false)]),
      false,
    );
    assert.equal(canPublish([a("answered", true), a("answered", true), a("answered", true)]), true);
  });

  test("allows exactly one retake per question", () => {
    assert.equal(CARD_MAX_TAKES, 2);
    assert.equal(takesLeft(0), 2);
    assert.equal(takesLeft(1), 1);
    assert.equal(takesLeft(2), 0);
    assert.equal(takesLeft(5), 0);
  });

  test("consent copy states sharing, deletion and the no-penalty rule", () => {
    const text = CARD_CONSENT_POINTS.join(" ").toLowerCase();
    assert.ok(text.includes("employers"));
    assert.ok(text.includes("withdraw"));
    assert.ok(text.includes("deleted"));
    assert.ok(text.includes("never counts against you"));
  });
});
