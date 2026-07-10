import { describe, expect, it } from "vitest";

import {
  DEFAULT_MARKER_ICON_PRESETS,
  isMarkerIconPreset,
  resolveMarkerIconPreset,
} from "@/lib/battle-plan/marker-icons.shared";

describe("marker icon presets", () => {
  it("validates known presets", () => {
    expect(isMarkerIconPreset("crossed-swords")).toBe(true);
    expect(isMarkerIconPreset("ordinal-3")).toBe(true);
    expect(isMarkerIconPreset("custom")).toBe(false);
  });

  it("falls back to ordinal defaults per marker slot", () => {
    expect(resolveMarkerIconPreset(1, null)).toBe("ordinal-1");
    expect(resolveMarkerIconPreset(3, "shield")).toBe("shield");
    expect(resolveMarkerIconPreset(5, "invalid")).toBe(
      DEFAULT_MARKER_ICON_PRESETS[5],
    );
  });
});
