import { describe, expect, it } from "vitest";

import {
  eventDisplayCalendarDate,
  groupEventsByCalendarDate,
} from "@/lib/battle-plan/display.shared";
import type { SerializedCaptureEvent } from "@/lib/battle-plan/types.shared";

function baseEvent(
  overrides: Partial<SerializedCaptureEvent> = {},
): SerializedCaptureEvent {
  return {
    id: "event-1",
    eventType: "capture",
    scheduledAt: "2026-07-12T02:00:00.000Z",
    serverCalendarDate: "2026-07-12",
    territoryType: "stronghold",
    iconPreset: "hammer",
    capturePolicy: "peace",
    effectiveCapturePolicy: "peace",
    notes: null,
    status: "scheduled",
    bankId: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("eventDisplayCalendarDate", () => {
  it("uses server calendar date in server display mode", () => {
    const event = baseEvent();
    expect(eventDisplayCalendarDate(event, "server")).toBe("2026-07-12");
  });

  it("uses the local calendar date in local display mode", () => {
    // Jul 11 10:00 PM America/New_York == Jul 12 02:00 UTC == Jul 12 00:00 server
    const event = baseEvent();
    expect(
      eventDisplayCalendarDate(event, "local", "America/New_York"),
    ).toBe("2026-07-11");
  });
});

describe("groupEventsByCalendarDate", () => {
  it("buckets late-evening local captures onto the local day", () => {
    const event = baseEvent();
    const localGrouped = groupEventsByCalendarDate(
      [event],
      "local",
      "America/New_York",
    );
    expect([...localGrouped.keys()]).toEqual(["2026-07-11"]);
    expect(localGrouped.get("2026-07-11")).toEqual([event]);

    const serverGrouped = groupEventsByCalendarDate([event], "server");
    expect([...serverGrouped.keys()]).toEqual(["2026-07-12"]);
  });
});
