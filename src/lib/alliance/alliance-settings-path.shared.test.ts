import { describe, expect, it } from "vitest";

import {
  allianceSeasonApiPath,
  allianceTagPathSegment,
  allianceTrainMinimumsApiPath,
  allianceTrainWeekApiPath,
} from "@/lib/alliance/alliance-settings-path.shared";

describe("alliance-settings-path", () => {
  it("lowercases tag in API paths", () => {
    expect(allianceTagPathSegment("LFgo")).toBe("lfgo");
    expect(allianceSeasonApiPath("LFgo")).toBe("/api/alliance/lfgo/season");
    expect(allianceTrainMinimumsApiPath("LFgo")).toBe(
      "/api/alliance/lfgo/train-minimums",
    );
    expect(allianceTrainWeekApiPath("LFgo")).toBe(
      "/api/alliance/lfgo/train-week",
    );
  });
});
