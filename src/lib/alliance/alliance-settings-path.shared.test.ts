import { describe, expect, it } from "vitest";

import {
  allianceSeasonApiPath,
  allianceSettingsPath,
  allianceTagPathSegment,
  allianceTrainMinimumsApiPath,
  allianceTrainWeekApiPath,
} from "@/lib/alliance/alliance-settings-path.shared";

describe("alliance-settings-path", () => {
  it("lowercases tag in paths", () => {
    expect(allianceTagPathSegment("LFgo")).toBe("lfgo");
    expect(allianceSettingsPath("LFgo")).toBe("/alliance/lfgo/settings");
    expect(allianceSeasonApiPath("LFgo")).toBe("/api/alliance/lfgo/season");
    expect(allianceTrainMinimumsApiPath("LFgo")).toBe(
      "/api/alliance/lfgo/train-minimums",
    );
    expect(allianceTrainWeekApiPath("LFgo")).toBe(
      "/api/alliance/lfgo/train-week",
    );
  });
});
