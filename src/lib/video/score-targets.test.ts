import { describe, expect, it } from "vitest";

import {
  ENABLED_SCORE_TARGETS,
  getScoreTarget,
  getScoreTargetOrThrow,
} from "@/lib/video/score-targets";

describe("score targets", () => {
  it("returns enabled targets including canyon storm", () => {
    expect(getScoreTarget("desert-storm")?.enabled).toBe(true);
    expect(getScoreTarget("canyon-storm")?.enabled).toBe(true);
    expect(getScoreTarget("alliance-star")?.enabled).toBe(false);
    expect(ENABLED_SCORE_TARGETS.some((target) => target.id === "desert-storm")).toBe(
      true,
    );
    expect(ENABLED_SCORE_TARGETS.some((target) => target.id === "seasonal")).toBe(
      true,
    );
  });

  it("returns undefined for unknown targets", () => {
    expect(getScoreTarget("missing")).toBeUndefined();
  });

  it("returns the target when it exists", () => {
    expect(getScoreTargetOrThrow("desert-storm").id).toBe("desert-storm");
  });

  it("throws for unknown targets when required", () => {
    expect(() => getScoreTargetOrThrow("missing")).toThrow(
      "Unknown score target: missing",
    );
  });
});
