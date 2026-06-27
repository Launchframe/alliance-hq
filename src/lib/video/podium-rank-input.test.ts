import { describe, expect, it } from "vitest";

import { parsePodiumRankInput } from "@/lib/video/podium-rank-input";

describe("parsePodiumRankInput", () => {
  it("returns null for empty input", () => {
    expect(parsePodiumRankInput("")).toBeNull();
    expect(parsePodiumRankInput("abc")).toBeNull();
  });

  it("accepts ranks 1 through 3", () => {
    expect(parsePodiumRankInput("1")).toBe(1);
    expect(parsePodiumRankInput("2")).toBe(2);
    expect(parsePodiumRankInput("3")).toBe(3);
  });

  it("clamps values above 3 to 3", () => {
    expect(parsePodiumRankInput("9")).toBe(3);
    expect(parsePodiumRankInput("45")).toBe(3);
  });

  it("strips non-digits and uses the first digit only", () => {
    expect(parsePodiumRankInput("r2")).toBe(2);
  });
});
