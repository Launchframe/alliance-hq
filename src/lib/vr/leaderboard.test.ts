import { describe, expect, it } from "vitest";

import { buildLeaderboardRows, formatDailyDiscordReport } from "@/lib/vr/leaderboard";

describe("leaderboard", () => {
  it("sorts by VR desc then THP desc", () => {
    const rows = buildLeaderboardRows(
      [
        {
          id: "1",
          allianceId: "a",
          ashedMemberId: "m1",
          seasonKey: "1",
          highestBaseVr: 5000,
          flaggedAt: null,
          flagReason: null,
          updatedByDiscordUserId: null,
          updatedByHqUserId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "2",
          allianceId: "a",
          ashedMemberId: "m2",
          seasonKey: "1",
          highestBaseVr: 5000,
          flaggedAt: null,
          flagReason: null,
          updatedByDiscordUserId: null,
          updatedByHqUserId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      [
        { id: "m1", current_name: "Alpha", total_hero_power: 100 },
        { id: "m2", current_name: "Beta", total_hero_power: 200 },
      ] as never[],
      [],
    );
    expect(rows[0]?.ashedMemberId).toBe("m2");
  });

  it("formats daily report", () => {
    expect(
      formatDailyDiscordReport(
        [
          {
            ashedMemberId: "m1",
            memberName: "Alpha",
            highestBaseVr: 7500,
            totalHeroPower: 1000,
            flagged: false,
            flagReason: null,
          },
        ],
        "42",
      ),
    ).toMatch(/7500 VR/);
  });
});
