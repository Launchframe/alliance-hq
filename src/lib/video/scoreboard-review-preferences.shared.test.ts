import { describe, expect, it } from "vitest";

import { canEditScoreboardReviewPreferences } from "./scoreboard-review-preferences.shared";

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
