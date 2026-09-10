import { describe, expect, it } from "vitest";

import type { LastRankMatchResult } from "@/lib/lastrank/alliance-page.shared";
import {
  buildLastRankRosterDiff,
  formatLastRankRosterDiffText,
} from "@/lib/lastrank/roster-diff.shared";

function emptyMatch(
  partial: Partial<LastRankMatchResult>,
): LastRankMatchResult {
  return {
    matched: [],
    unmatched: [],
    unmatchedHq: [],
    ...partial,
  };
}

describe("buildLastRankRosterDiff", () => {
  it("lists excess HQ and missing LastRank names", () => {
    const diff = buildLastRankRosterDiff({
      lastRankCount: 2,
      match: emptyMatch({
        matched: [
          {
            status: "matched",
            lastRank: {
              publicId: 1,
              name: "Keep",
              country: null,
              power: null,
              heroPower: null,
              allianceRank: null,
              baseLevel: null,
              originServerId: null,
            },
            hq: {
              commanderId: "c1",
              ashedMemberId: "m1",
              gameUid: null,
              currentNames: ["Keep"],
              previousNames: [],
              hqThp: null,
              hqLevel: null,
              hqPowerLevel: null,
              hqAllianceRank: null,
              existingCanonicalName: null,
              lastrankPublicId: 1,
              lastrankCountry: null,
              lastrankProfileImageUrl: null,
              lastrankProfileUrl: null,
            },
            matchMethod: "exact_current",
            fuzzyScore: null,
          },
        ],
        unmatched: [
          {
            status: "unmatched",
            lastRank: {
              publicId: 2,
              name: "NewJoin",
              country: null,
              power: null,
              heroPower: null,
              allianceRank: null,
              baseLevel: null,
              originServerId: null,
            },
            hqCommanderIds: [],
            suggestions: [],
          },
        ],
        unmatchedHq: [
          {
            commanderId: "c2",
            ashedMemberId: "m2",
            gameUid: null,
            currentNames: ["LeaverOne"],
            previousNames: [],
            hqThp: null,
            hqLevel: null,
            hqPowerLevel: null,
            hqAllianceRank: null,
            existingCanonicalName: null,
            lastrankPublicId: null,
            lastrankCountry: null,
            lastrankProfileImageUrl: null,
            lastrankProfileUrl: null,
          },
          {
            commanderId: "c3",
            ashedMemberId: "m3",
            gameUid: null,
            currentNames: ["LeaverTwo"],
            previousNames: [],
            hqThp: null,
            hqLevel: null,
            hqPowerLevel: null,
            hqAllianceRank: null,
            existingCanonicalName: null,
            lastrankPublicId: null,
            lastrankCountry: null,
            lastrankProfileImageUrl: null,
            lastrankProfileUrl: null,
          },
        ],
      }),
    });

    expect(diff.excessHq).toEqual(["LeaverOne", "LeaverTwo"]);
    expect(diff.missingFromHq).toEqual(["NewJoin"]);
    expect(diff.hqActiveCount).toBe(3);
    expect(diff.matched).toBe(1);
  });
});

describe("formatLastRankRosterDiffText", () => {
  it("prints excess and missing sections", () => {
    const text = formatLastRankRosterDiffText({
      tag: "LFgo",
      gameServerNumber: 1203,
      diff: {
        lastRankCount: 95,
        hqActiveCount: 98,
        matched: 95,
        excessHq: ["A", "B", "C"],
        missingFromHq: [],
        ambiguous: [],
      },
    });
    expect(text).toContain("Excess in HQ (not on LastRank): 3");
    expect(text).toContain("    - A");
    expect(text).toContain("Missing from HQ (on LastRank only): 0");
  });
});
