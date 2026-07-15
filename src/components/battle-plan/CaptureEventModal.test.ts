import { describe, expect, it, vi } from "vitest";

import { captureEventFormToPayload } from "@/components/battle-plan/CaptureEventModal";
import type { CaptureEventFormValues } from "@/components/battle-plan/CaptureEventModal";
import { zonedDateTimeToIso } from "@/lib/battle-plan/time-display.shared";
import { SERVER_TIME_IANA } from "@/lib/timezone/constants";

function baseValues(
  overrides: Partial<CaptureEventFormValues> = {},
): CaptureEventFormValues {
  return {
    scheduleMode: "absolute",
    scheduledDate: "2026-07-12",
    scheduledTime: "14:30",
    relativeDuration: "",
    territoryType: "stronghold",
    iconPreset: "hammer",
    capturePolicy: "peace",
    notes: "",
    status: "scheduled",
    gameServerNumber: "",
    coordX: "",
    coordY: "",
    level: "",
    ...overrides,
  };
}

describe("captureEventFormToPayload", () => {
  it("uses zoned date and time in absolute mode", () => {
    const payload = captureEventFormToPayload(baseValues(), "server");
    expect(payload.scheduledAt).toBe(
      zonedDateTimeToIso("2026-07-12", "14:30", SERVER_TIME_IANA),
    );
  });

  it("uses relative duration digits in from-now mode", () => {
    const now = new Date("2026-07-10T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const payload = captureEventFormToPayload(
        baseValues({
          scheduleMode: "relative",
          relativeDuration: "000130",
        }),
        "server",
      );
      expect(payload.scheduledAt).toBe("2026-07-10T13:30:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps optional stronghold coordinates to payload numbers", () => {
    const payload = captureEventFormToPayload(
      baseValues({
        gameServerNumber: "42",
        coordX: "699",
        coordY: "539",
        level: "3",
      }),
      "server",
    );
    expect(payload).toMatchObject({
      gameServerNumber: 42,
      coordX: 699,
      coordY: 539,
      level: 3,
    });
  });

  it("omits invalid coordinate fields from payload", () => {
    const payload = captureEventFormToPayload(
      baseValues({
        gameServerNumber: "abc",
        coordX: "",
        coordY: "   ",
        level: "",
      }),
      "server",
    );
    expect(payload).toMatchObject({
      gameServerNumber: null,
      coordX: null,
      coordY: null,
      level: null,
    });
  });
});
