import { describe, expect, it } from "vitest";

import { findFutureMarkerConflict } from "@/lib/battle-plan/marker-conflict.shared";
import type { SerializedCaptureEvent } from "@/lib/battle-plan/types.shared";

const baseEvent = (
  overrides: Partial<SerializedCaptureEvent>,
): SerializedCaptureEvent => ({
  id: "evt-1",
  scheduledAt: "2026-07-15T15:00:00.000Z",
  serverCalendarDate: "2026-07-15",
  territoryType: "stronghold",
  markerNumber: 2,
  capturePolicy: "peace",
  effectiveCapturePolicy: "peace",
  notes: null,
  status: "scheduled",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  ...overrides,
});

describe("findFutureMarkerConflict", () => {
  const now = new Date("2026-07-10T12:00:00.000Z");

  it("returns a future scheduled event using the same marker", () => {
    const events = [
      baseEvent({ id: "a", markerNumber: 2 }),
      baseEvent({ id: "b", markerNumber: 3 }),
    ];
    expect(findFutureMarkerConflict(events, 2, { now })).toMatchObject({
      id: "a",
    });
  });

  it("ignores the event being edited and past or cancelled captures", () => {
    const events = [
      baseEvent({ id: "self", markerNumber: 2 }),
      baseEvent({
        id: "past",
        markerNumber: 2,
        scheduledAt: "2026-07-09T15:00:00.000Z",
      }),
      baseEvent({
        id: "cancelled",
        markerNumber: 2,
        status: "cancelled",
      }),
    ];
    expect(
      findFutureMarkerConflict(events, 2, { excludeEventId: "self", now }),
    ).toBeNull();
  });
});
