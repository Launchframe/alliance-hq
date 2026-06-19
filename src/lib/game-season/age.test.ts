import { describe, expect, it } from "vitest";

import {
  seasonFromServerAge,
  seasonKeyFromAge,
  serverAgeDays,
} from "@/lib/game-season/age";

describe("serverAgeDays", () => {
  it("counts UTC calendar days with 2h offset", () => {
    const open = new Date("2024-12-26T02:00:00.000Z").getTime();
    const now = new Date("2026-06-16T02:00:00.000Z");
    expect(serverAgeDays(open, now)).toBe(538);
  });
});

describe("seasonFromServerAge", () => {
  it("maps cpt-hedge thresholds", () => {
    expect(seasonFromServerAge(120)).toBe(0);
    expect(seasonFromServerAge(121)).toBe(1);
    expect(seasonFromServerAge(176)).toBe(1);
    expect(seasonFromServerAge(177)).toBe(2);
    expect(seasonFromServerAge(260)).toBe(2);
    expect(seasonFromServerAge(261)).toBe(3);
    expect(seasonFromServerAge(351)).toBe(3);
    expect(seasonFromServerAge(352)).toBe(4);
  });

  it("caps at season 4 for older servers", () => {
    expect(seasonKeyFromAge(Date.parse("2020-01-01"))).toBe("4");
  });
});
