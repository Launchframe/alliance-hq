import { describe, expect, it } from "vitest";

import { shouldReplaceAshedScoresOnSubmit } from "./ashed-score-replace.shared";
import { getScoreTargetOrThrow } from "./score-targets";

describe("shouldReplaceAshedScoresOnSubmit", () => {
  it("replaces desert-storm when event id is present", () => {
    expect(
      shouldReplaceAshedScoresOnSubmit(getScoreTargetOrThrow("desert-storm"), {
        eventId: "ev-1",
      }),
    ).toBe(true);
  });

  it("does not replace desert-storm without event id", () => {
    expect(
      shouldReplaceAshedScoresOnSubmit(getScoreTargetOrThrow("desert-storm"), {
        eventId: null,
      }),
    ).toBe(false);
  });

  it("replaces vs-performance by recorded date (no event)", () => {
    expect(
      shouldReplaceAshedScoresOnSubmit(
        getScoreTargetOrThrow("vs-performance"),
        {},
      ),
    ).toBe(true);
  });

  it("replaces donations by recorded date", () => {
    expect(
      shouldReplaceAshedScoresOnSubmit(getScoreTargetOrThrow("donations"), {}),
    ).toBe(true);
  });

  it("replaces alliance-kills-video by recorded date", () => {
    expect(
      shouldReplaceAshedScoresOnSubmit(
        getScoreTargetOrThrow("alliance-kills-video"),
        {},
      ),
    ).toBe(true);
  });

  it("does not replace HQ-event-store seasonal targets", () => {
    expect(
      shouldReplaceAshedScoresOnSubmit(getScoreTargetOrThrow("seasonal"), {
        eventId: "ev-1",
      }),
    ).toBe(false);
  });

  it("does not replace row-post frontline targets", () => {
    expect(
      shouldReplaceAshedScoresOnSubmit(
        getScoreTargetOrThrow("frontline-breakthrough"),
        { eventId: "ev-1" },
      ),
    ).toBe(false);
  });
});
