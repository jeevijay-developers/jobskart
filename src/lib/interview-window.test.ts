import { describe, it as test } from "node:test";
import assert from "node:assert/strict";
import { isInReminderSendWindow } from "./interview-window.ts";

describe("isInReminderSendWindow", () => {
  const scheduled = new Date("2026-09-22T12:00:00.000Z");

  test("false more than 30 minutes before start", () => {
    assert.equal(
      isInReminderSendWindow(scheduled.toISOString(), 60, new Date("2026-09-22T11:29:00.000Z")),
      false,
    );
  });

  test("true at T-30", () => {
    assert.equal(
      isInReminderSendWindow(scheduled.toISOString(), 60, new Date("2026-09-22T11:30:00.000Z")),
      true,
    );
  });

  test("true after start while the join window is still open", () => {
    assert.equal(
      isInReminderSendWindow(scheduled.toISOString(), 60, new Date("2026-09-22T12:10:00.000Z")),
      true,
    );
  });

  test("true right at join window close boundary (duration + 15 min)", () => {
    assert.equal(
      isInReminderSendWindow(scheduled.toISOString(), 60, new Date("2026-09-22T13:15:00.000Z")),
      true,
    );
  });

  test("false after join window closes (duration + 15 min)", () => {
    assert.equal(
      isInReminderSendWindow(scheduled.toISOString(), 60, new Date("2026-09-22T13:16:00.000Z")),
      false,
    );
  });
});

