import { describe, expect, it } from "vitest";

import {
  allianceRegularEventsApiPath,
  allianceSeasonApiPath,
  allianceTagPathSegment,
  allianceTrainMinimumsApiPath,
  allianceTrainTopScoreEligibilityApiPath,
  allianceTrainWeekApiPath,
} from "@/lib/alliance/alliance-settings-path.shared";

describe("alliance-settings-path", () => {
  it("lowercases tag in API paths", () => {
    expect(allianceTagPathSegment("LFgo")).toBe("lfgo");
    expect(allianceSeasonApiPath("LFgo")).toBe("/api/alliance/lfgo/season");
    expect(allianceTrainMinimumsApiPath("LFgo")).toBe(
      "/api/alliance/lfgo/train-minimums",
    );
    expect(allianceTrainTopScoreEligibilityApiPath("LFgo")).toBe(
      "/api/alliance/lfgo/train-top-score-eligibility",
    );
    expect(allianceTrainWeekApiPath("LFgo")).toBe(
      "/api/alliance/lfgo/train-week",
    );
    expect(allianceRegularEventsApiPath("LFgo")).toBe(
      "/api/alliance/lfgo/regular-events",
    );
  });
});
