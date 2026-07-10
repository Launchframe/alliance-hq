import { describe, expect, it } from "vitest";

import {
  isMarkerIconPreset,
  MARKER_ICON_PRESETS,
} from "@/lib/battle-plan/marker-icons.shared";

describe("marker icon presets", () => {
  it("validates known presets", () => {
    expect(isMarkerIconPreset("crossed-swords")).toBe(true);
    expect(isMarkerIconPreset("diamond")).toBe(true);
    expect(isMarkerIconPreset("ordinal-3")).toBe(true);
    expect(isMarkerIconPreset("custom")).toBe(false);
  });

  it("places diamond between triangle and crescent", () => {
    const triangleIndex = MARKER_ICON_PRESETS.indexOf("triangle");
    const diamondIndex = MARKER_ICON_PRESETS.indexOf("diamond");
    const crescentIndex = MARKER_ICON_PRESETS.indexOf("crescent");
    expect(diamondIndex).toBe(triangleIndex + 1);
    expect(crescentIndex).toBe(diamondIndex + 1);
  });
});
