import { describe, expect, it } from "vitest";

import {
  collectUsedMarkerPresets,
  findMarkerPresetConflict,
} from "@/lib/battle-plan/marker-conflict.shared";
import type { SerializedCaptureEvent } from "@/lib/battle-plan/types.shared";

const baseEvent = (
  overrides: Partial<SerializedCaptureEvent>,
): SerializedCaptureEvent => ({
  id: "evt-1",
  scheduledAt: "2026-07-15T15:00:00.000Z",
  serverCalendarDate: "2026-07-15",
  territoryType: "stronghold",
  iconPreset: "hammer",
  capturePolicy: "peace",
  effectiveCapturePolicy: "peace",
  notes: null,
  status: "scheduled",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  ...overrides,
});

describe("findMarkerPresetConflict", () => {
  it("returns a scheduled event using the same marker preset", () => {
    const events = [
      baseEvent({ id: "a", iconPreset: "hammer" }),
      baseEvent({ id: "b", iconPreset: "sun" }),
    ];
    expect(findMarkerPresetConflict(events, "hammer")).toMatchObject({
      id: "a",
    });
  });

  it("ignores null presets, the event being edited, and non-scheduled captures", () => {
    const events = [
      baseEvent({ id: "self", iconPreset: "hammer" }),
      baseEvent({ id: "cancelled", iconPreset: "hammer", status: "cancelled" }),
    ];
    expect(
      findMarkerPresetConflict(events, "hammer", { excludeEventId: "self" }),
    ).toBeNull();
    expect(findMarkerPresetConflict(events, null)).toBeNull();
  });
});

describe("collectUsedMarkerPresets", () => {
  it("collects presets from other scheduled events", () => {
    const events = [
      baseEvent({ id: "a", iconPreset: "hammer" }),
      baseEvent({ id: "b", iconPreset: "sun" }),
      baseEvent({ id: "c", iconPreset: null }),
      baseEvent({ id: "d", iconPreset: "hammer", status: "completed" }),
    ];
    expect(collectUsedMarkerPresets(events, { excludeEventId: "self" })).toEqual(
      new Set(["hammer", "sun"]),
    );
  });
});
