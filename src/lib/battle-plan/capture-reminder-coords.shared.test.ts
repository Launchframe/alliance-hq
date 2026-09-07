import { describe, expect, it } from "vitest";

import {
  hasCompleteCaptureCoords,
  parseCaptureReminderCoordsBody,
  validateCaptureReminderCoords,
} from "@/lib/battle-plan/capture-reminder-coords.shared";

describe("capture-reminder-coords.shared", () => {
  it("detects complete coords", () => {
    expect(
      hasCompleteCaptureCoords({
        gameServerNumber: 742,
        coordX: 100,
        coordY: 200,
        level: 5,
      }),
    ).toBe(true);
    expect(
      hasCompleteCaptureCoords({
        gameServerNumber: 742,
        coordX: 100,
        coordY: null,
        level: 5,
      }),
    ).toBe(false);
  });

  it("parses coord body from numbers or numeric strings", () => {
    expect(
      parseCaptureReminderCoordsBody({
        gameServerNumber: 742,
        coordX: "100",
        coordY: 200,
        level: "5",
      }),
    ).toEqual({
      gameServerNumber: 742,
      coordX: 100,
      coordY: 200,
      level: 5,
    });
    expect(parseCaptureReminderCoordsBody({ gameServerNumber: 1 })).toBeNull();
  });

  it("validates coord ranges", () => {
    expect(
      validateCaptureReminderCoords({
        gameServerNumber: 742,
        coordX: 100,
        coordY: 200,
        level: 5,
      }),
    ).toBeNull();
    expect(
      validateCaptureReminderCoords({
        gameServerNumber: 0,
        coordX: 100,
        coordY: 200,
        level: 5,
      }),
    ).toMatch(/server number/i);
  });
});
