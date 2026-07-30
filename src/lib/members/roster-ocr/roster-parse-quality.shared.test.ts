import { describe, expect, it } from "vitest";

import { assembleMemberRowLines } from "@/lib/members/roster-ocr/assemble-member-rows.shared";
import {
  isLowQualityRosterParse,
  ROSTER_LOW_QUALITY_BANNER,
} from "@/lib/members/roster-ocr/roster-parse-quality.shared";

describe("assembleMemberRowLines", () => {
  it("merges name and stats lines on the same y-band", () => {
    const lines = assembleMemberRowLines([
      { text: "C Price", bbox: { y0: 100, y1: 120 } },
      { text: "Power: 94.1M Lv.26", bbox: { y0: 105, y1: 125 } },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toContain("C Price");
    expect(lines[0]?.text).toContain("94.1M");
  });

  it("keeps header lines separate when no member stats", () => {
    const lines = assembleMemberRowLines([
      { text: "R3", bbox: { y0: 50, y1: 70 } },
      { text: "Heart of the Alliance 7/83", bbox: { y0: 55, y1: 75 } },
    ]);
    expect(lines.length).toBeGreaterThanOrEqual(1);
  });

  it("returns plain text when no bbox geometry", () => {
    const lines = assembleMemberRowLines([
      { text: "C Price" },
      { text: "Power: 94.1M Lv.26" },
    ]);
    expect(lines).toHaveLength(2);
  });

  // Real Steel pass 2 (Sonnet): isHeaderBandLine used to probe
  // parseRankGroupHeader with a hardcoded `{ currentRank: 3 }` context, which
  // collided with the new same-rank guard for exactly rank-3 loose headers
  // (e.g. "R3) on M"), causing them to merge into the following member band
  // instead of staying separate. Probing with no ctx fixes this.
  it("does not merge a loose same-line rank-3 header (no quota) with an adjacent line in the same y-band", () => {
    // Both lines fall within Y_CLUSTER_TOLERANCE_PX so they'd normally merge
    // into one combined-text row — unless isHeaderBandLine flags the header.
    const lines = assembleMemberRowLines([
      { text: "R3) on M", bbox: { y0: 50, y1: 70 } },
      { text: "some noise", bbox: { y0: 55, y1: 75 } },
    ]);
    expect(lines.map((l) => l.text)).toEqual(["R3) on M", "some noise"]);
  });
});

describe("isLowQualityRosterParse", () => {
  it("flags header-like rows with no stats", () => {
    const quality = isLowQualityRosterParse([
      {
        extractedName: "Heart of the Alliance",
        allianceRank: 3,
        layout: "rank_list",
      },
      {
        extractedName: "Heart of thc Alliance",
        allianceRank: 3,
        layout: "rank_list",
      },
    ]);
    expect(quality.lowQuality).toBe(true);
    expect(quality.reason).toBe("header_like_rows");
  });

  it("accepts plausible member rows with stats", () => {
    const quality = isLowQualityRosterParse(
      Array.from({ length: 15 }, (_, i) => ({
        extractedName: `Player${i}`,
        allianceRank: 3 as const,
        heroPowerM: 10 + i,
        memberLevel: 20 + i,
        layout: "rank_list" as const,
      })),
    );
    expect(quality.lowQuality).toBe(false);
  });

  it("exports a user-facing banner message", () => {
    expect(ROSTER_LOW_QUALITY_BANNER).toMatch(/scroll slowly/i);
  });
});
