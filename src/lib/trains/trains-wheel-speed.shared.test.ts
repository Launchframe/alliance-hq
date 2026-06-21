import { describe, expect, it } from "vitest";

import {
  DEFAULT_TRAINS_WHEEL_SPIN_SPEED,
  normalizeTrainsWheelSpinSpeed,
  wheelSpeedMultiplier,
} from "@/lib/trains/trains-wheel-speed.shared";

describe("normalizeTrainsWheelSpinSpeed", () => {
  it("accepts known speed keys", () => {
    expect(normalizeTrainsWheelSpinSpeed("slow")).toBe("slow");
    expect(normalizeTrainsWheelSpinSpeed("regular")).toBe("regular");
    expect(normalizeTrainsWheelSpinSpeed("fast")).toBe("fast");
  });

  it("falls back to the default for invalid values", () => {
    expect(normalizeTrainsWheelSpinSpeed(null)).toBe(
      DEFAULT_TRAINS_WHEEL_SPIN_SPEED,
    );
    expect(normalizeTrainsWheelSpinSpeed("turbo")).toBe(
      DEFAULT_TRAINS_WHEEL_SPIN_SPEED,
    );
  });
});

describe("wheelSpeedMultiplier", () => {
  it("returns higher multiplier for faster presets", () => {
    expect(wheelSpeedMultiplier("slow")).toBe(1);
    expect(wheelSpeedMultiplier("regular")).toBe(2);
    expect(wheelSpeedMultiplier("fast")).toBe(3);
  });
});
