import { describe, expect, it } from "vitest";

import {
  buildLeaderboardRows,
  buildTakedownTeams,
  formatDailyDiscordReport,
  formatTakedownReport,
  formatVrLeaderboard,
  memberTotalHeroPower,
} from "@/lib/vr/leaderboard";

function sampleRow(
  id: string,
  vr: number,
  thp: number,
  name?: string,
) {
  return {
    ashedMemberId: id,
    memberName: name ?? id,
    highestBaseVr: vr,
    totalHeroPower: thp,
    flagged: false,
    flagReason: null,
  };
}

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

  it("maps heroPowerM to THP for native roster members", () => {
    expect(
      memberTotalHeroPower({
        id: "m1",
        current_name: "Alpha",
        heroPowerM: 4.2,
      } as never),
    ).toBe(4_200_000);
  });

  it("formats daily report via formatVrLeaderboard", () => {
    expect(
      formatDailyDiscordReport(
        [sampleRow("m1", 7500, 1000, "Alpha")],
        "42",
      ),
    ).toMatch(/7500 VR/);
  });

  it("limits formatVrLeaderboard to top 25", () => {
    const rows = Array.from({ length: 30 }, (_, index) =>
      sampleRow(`m${index}`, 5000 - index, index, `P${index}`),
    );
    const formatted = formatVrLeaderboard(rows, "1", { limit: 25 });
    expect(formatted.match(/^\d+\./gm)).toHaveLength(25);
  });

  it("builds a 2-team takedown plan with snake THP assignment", () => {
    const rows = [
      sampleRow("lead1", 7500, 900, "Lead1"),
      sampleRow("lead2", 7000, 850, "Lead2"),
      sampleRow("f1", 6500, 800, "F1"),
      sampleRow("f2", 6400, 790, "F2"),
      sampleRow("f3", 6300, 780, "F3"),
      sampleRow("f4", 6200, 770, "F4"),
      sampleRow("f5", 6100, 760, "F5"),
      sampleRow("f6", 6000, 750, "F6"),
      sampleRow("f7", 5900, 740, "F7"),
      sampleRow("f8", 5800, 730, "F8"),
    ];

    const result = buildTakedownTeams(rows, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.teams).toHaveLength(2);
    expect(result.teams[0]?.rallyLead.memberName).toBe("Lead1");
    expect(result.teams[1]?.rallyLead.memberName).toBe("Lead2");
    expect(result.teams[0]?.fillers.map((f) => f.memberName)).toEqual([
      "F1",
      "F4",
      "F5",
      "F8",
    ]);
    expect(result.teams[1]?.fillers.map((f) => f.memberName)).toEqual([
      "F2",
      "F3",
      "F6",
      "F7",
    ]);

    const formatted = formatTakedownReport(result.teams, "3", "LFgo");
    expect(formatted).toMatch(/2 takedown teams \(LFgo\)/);
    expect(formatted).toMatch(/inherits 7500 VR/);
  });

  it("returns insufficient players when roster is too small", () => {
    const result = buildTakedownTeams([sampleRow("m1", 7500, 100)], 2);
    expect(result).toEqual({
      ok: false,
      error: "insufficient_players",
      needed: 10,
      have: 1,
    });
  });
});
