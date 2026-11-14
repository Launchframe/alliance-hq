import { describe, expect, it } from "vitest";

import {
  canEditScoreboardReviewPreferences,
  DEFAULT_SCOREBOARD_REVIEW_PREFERENCES,
} from "./scoreboard-review-preferences.shared";

describe("DEFAULT_SCOREBOARD_REVIEW_PREFERENCES", () => {
  it("defaults create and rename offers on", () => {
    expect(DEFAULT_SCOREBOARD_REVIEW_PREFERENCES).toEqual({
      offerCreate: true,
      offerRename: true,
    });
  });
});

describe("canEditScoreboardReviewPreferences", () => {
  it("allows officers and platform maintainers", () => {
    expect(
      canEditScoreboardReviewPreferences({
        roleName: "officer",
        isPlatformMaintainer: false,
      }),
    ).toBe(true);
    expect(
      canEditScoreboardReviewPreferences({
        roleName: "member",
        isPlatformMaintainer: true,
      }),
    ).toBe(true);
  });

  it("hides settings from data-entry and members", () => {
    expect(
      canEditScoreboardReviewPreferences({
        roleName: "data_entry",
        isPlatformMaintainer: false,
      }),
    ).toBe(false);
    expect(
      canEditScoreboardReviewPreferences({
        roleName: "member",
        isPlatformMaintainer: false,
      }),
    ).toBe(false);
  });
});
