import { describe, expect, it } from "vitest";

import { shouldRetainLastGoodCptSeason } from "@/lib/game-season/keep-last-good-cpt.shared";
import { resolveSeasonFromAgeFallback } from "@/lib/game-season/resolve";

describe("shouldRetainLastGoodCptSeason", () => {
  it("retains prior cpt-hedge S5+ when the live fetch misses (age would cap at 4)", () => {
    // Concrete trigger: Monday cron / applyGameServerSeasonSync after an empty
    // cpt-hedge parse. Server was previously synced to season 5 via cpt-hedge;
    // open timestamp age maps to capped season 4.
    const age = resolveSeasonFromAgeFallback(1_735_204_501_000);
    expect(Number.parseInt(age.seasonKey, 10)).toBeLessThanOrEqual(4);

    // RED without keep-last-good: callers would persist age.seasonKey ("4") and
    // clear post-season for every alliance on the server.
    expect(
      shouldRetainLastGoodCptSeason({
        cptRecordFound: false,
        priorSeasonKeySource: "cpt-hedge",
        priorSeasonKeySynced: "5",
      }),
    ).toBe(true);
  });

  it("retains prior cpt-hedge post-season lock when fetch throws/misses", () => {
    expect(
      shouldRetainLastGoodCptSeason({
        cptRecordFound: false,
        priorSeasonKeySource: "cpt-hedge",
        priorSeasonKeySynced: "4",
      }),
    ).toBe(true);
  });

  it("does not retain when cpt-hedge returned a live record", () => {
    expect(
      shouldRetainLastGoodCptSeason({
        cptRecordFound: true,
        priorSeasonKeySource: "cpt-hedge",
        priorSeasonKeySynced: "5",
      }),
    ).toBe(false);
  });

  it("allows age-fallback on first sync (no prior cpt-hedge)", () => {
    expect(
      shouldRetainLastGoodCptSeason({
        cptRecordFound: false,
        priorSeasonKeySource: "default",
        priorSeasonKeySynced: "1",
      }),
    ).toBe(false);
    expect(
      shouldRetainLastGoodCptSeason({
        cptRecordFound: false,
        priorSeasonKeySource: "age-fallback",
        priorSeasonKeySynced: "4",
      }),
    ).toBe(false);
    expect(
      shouldRetainLastGoodCptSeason({
        cptRecordFound: false,
        priorSeasonKeySource: null,
        priorSeasonKeySynced: null,
      }),
    ).toBe(false);
  });
});
