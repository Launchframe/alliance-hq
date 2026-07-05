import { describe, expect, it } from "vitest";

import {
  baseVrForInstituteLevel,
  instituteLevelForBaseVr,
  maxBaseVrForSeason,
  minBaseVrForSeason,
  nextInstituteLevel,
  validateBaseVrForSeason,
} from "@/lib/vr/institute-levels.shared";

describe("institute VR ladders", () => {
  it("uses season-specific progressions", () => {
    expect(baseVrForInstituteLevel("1", 16)).toBe(3400);
    expect(baseVrForInstituteLevel("5", 16)).toBe(3250);
    expect(baseVrForInstituteLevel("6", 1)).toBe(250);
    expect(maxBaseVrForSeason("5")).toBe(28000);
    expect(maxBaseVrForSeason("1")).toBe(10000);
  });

  it("maps VR to the highest matching institute level", () => {
    expect(instituteLevelForBaseVr("3", 400)).toBe(5);
    expect(instituteLevelForBaseVr("1", 400)).toBe(4);
  });

  it("bumps institute level by one", () => {
    expect(nextInstituteLevel("1", null)).toBe(1);
    expect(nextInstituteLevel("1", 15)).toBe(16);
    expect(baseVrForInstituteLevel("1", 16)).toBe(3400);
    expect(nextInstituteLevel("1", 30)).toBeNull();
  });

  it("validates manual VR against the season ladder", () => {
    expect(validateBaseVrForSeason("1", 3400)).toEqual({
      ok: true,
      instituteLevel: 16,
      baseVr: 3400,
    });
    expect(validateBaseVrForSeason("1", 3300)).toEqual({
      ok: false,
      kind: "not_on_ladder",
      lower: 3000,
      upper: 3400,
    });
    expect(validateBaseVrForSeason("1", -1)).toEqual({
      ok: false,
      kind: "out_of_range",
      min: minBaseVrForSeason("1"),
      max: maxBaseVrForSeason("1"),
    });
    expect(validateBaseVrForSeason("1", 99999)).toEqual({
      ok: false,
      kind: "out_of_range",
      min: minBaseVrForSeason("1"),
      max: maxBaseVrForSeason("1"),
    });
  });
});
