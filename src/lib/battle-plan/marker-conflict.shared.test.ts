import { describe, expect, it } from "vitest";

import {
  collectUsedMarkerPresets,
  findMarkerPresetConflict,
  findNextAvailableMarkerPreset,
} from "@/lib/battle-plan/marker-conflict.shared";
import type { SerializedCaptureEvent } from "@/lib/battle-plan/types.shared";

const now = new Date("2026-07-15T12:00:00.000Z");

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
    expect(
      findMarkerPresetConflict(events, "hammer", { now }),
    ).toMatchObject({
      id: "a",
    });
  });

  it("ignores null presets, the event being edited, past scheduled events, and non-scheduled captures", () => {
    const events = [
      baseEvent({ id: "self", iconPreset: "hammer" }),
      baseEvent({ id: "cancelled", iconPreset: "hammer", status: "cancelled" }),
      baseEvent({
        id: "past",
        iconPreset: "hammer",
        scheduledAt: "2026-07-14T15:00:00.000Z",
      }),
    ];
    expect(
      findMarkerPresetConflict(events, "hammer", {
        excludeEventId: "self",
        now,
      }),
    ).toBeNull();
    expect(findMarkerPresetConflict(events, null, { now })).toBeNull();
  });

  it("ignores past scheduled events when detecting conflicts", () => {
    const events = [
      baseEvent({
        id: "past",
        iconPreset: "hammer",
        scheduledAt: "2026-07-14T15:00:00.000Z",
      }),
    ];
    expect(findMarkerPresetConflict(events, "hammer", { now })).toBeNull();
  });
});

describe("collectUsedMarkerPresets", () => {
  it("collects presets from other upcoming scheduled events", () => {
    const events = [
      baseEvent({ id: "a", iconPreset: "hammer" }),
      baseEvent({ id: "b", iconPreset: "sun" }),
      baseEvent({ id: "c", iconPreset: null }),
      baseEvent({ id: "d", iconPreset: "hammer", status: "completed" }),
      baseEvent({
        id: "e",
        iconPreset: "ordinal-1",
        scheduledAt: "2026-07-14T15:00:00.000Z",
      }),
    ];
    expect(
      collectUsedMarkerPresets(events, { excludeEventId: "self", now }),
    ).toEqual(new Set(["hammer", "sun"]));
  });
});

describe("findNextAvailableMarkerPreset", () => {
  it("returns the first free ordinal marker", () => {
    const events = [
      baseEvent({ id: "a", iconPreset: "ordinal-1" }),
      baseEvent({ id: "b", iconPreset: "ordinal-2" }),
    ];
    expect(findNextAvailableMarkerPreset(events, { now })).toBe("ordinal-3");
  });

  it("reuses markers from past scheduled events", () => {
    const events = [
      baseEvent({
        id: "past",
        iconPreset: "ordinal-1",
        scheduledAt: "2026-07-14T15:00:00.000Z",
      }),
    ];
    expect(findNextAvailableMarkerPreset(events, { now })).toBe("ordinal-1");
  });
});
