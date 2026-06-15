import { describe, expect, it } from "vitest";

import {
  isValidBaseVr,
  maxAllowedDowngrade,
  nextBaseVr,
  VR_MAX,
  VR_MIN,
  VR_STEP,
} from "@/lib/vr/validation";

describe("base VR validation", () => {
  it("accepts multiples of 250 within range", () => {
    expect(isValidBaseVr(VR_MIN)).toBe(true);
    expect(isValidBaseVr(7500)).toBe(true);
    expect(isValidBaseVr(VR_MAX)).toBe(true);
  });

  it("rejects invalid steps and out-of-range values", () => {
    expect(isValidBaseVr(850)).toBe(false);
    expect(isValidBaseVr(7501)).toBe(false);
    expect(isValidBaseVr(VR_MAX + 250)).toBe(false);
    expect(isValidBaseVr(0)).toBe(false);
  });

  it("bumps by 250 and caps downgrade one step", () => {
    expect(nextBaseVr(7250)).toBe(7500);
    expect(maxAllowedDowngrade(7500)).toBe(7250);
    expect(maxAllowedDowngrade(VR_MIN)).toBe(VR_MIN);
  });
});

describe("VR_STEP constant", () => {
  it("is 250", () => {
    expect(VR_STEP).toBe(250);
  });
});
