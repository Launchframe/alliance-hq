import { describe, expect, it } from "vitest";

import {
  buildCommanderTeams,
  summarizeByMainSquad,
  type CommanderTeamRow,
} from "@/lib/commanders/team-builder.shared";

function row(
  id: string,
  thp: number,
  squad: CommanderTeamRow["mainSquad"] = null,
  rank = 1,
): CommanderTeamRow {
  return {
    ashedMemberId: id,
    memberName: id,
    totalHeroPower: thp,
    mainSquad: squad,
    mainSquadSource: squad ? "self_report" : null,
    allianceRank: rank,
    highestBaseVr: null,
  };
}

describe("team-builder.shared", () => {
  it("builds teams with THP leads and snake-distributed fillers", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`m${i}`, 1000 - i * 10));
    const result = buildCommanderTeams(rows, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.teams).toHaveLength(2);
    expect(result.teams[0]?.lead.ashedMemberId).toBe("m0");
    expect(result.teams[1]?.lead.ashedMemberId).toBe("m1");
    expect(result.teams[0]?.fillers).toHaveLength(4);
  });

  it("returns insufficient_players when pool is too small", () => {
    const result = buildCommanderTeams([row("m0", 100)], 2);
    expect(result).toEqual({
      ok: false,
      error: "insufficient_players",
      needed: 10,
      have: 1,
    });
  });

  it("filters by main squad", () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => row(`a${i}`, 500 - i, "aircraft")),
      ...Array.from({ length: 5 }, (_, i) => row(`t${i}`, 400 - i, "tank")),
    ];
    const result = buildCommanderTeams(rows, 1, { mainSquad: "aircraft" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.teams[0]?.lead.mainSquad).toBe("aircraft");
    expect(result.teams[0]?.fillers.every((f) => f.mainSquad === "aircraft")).toBe(
      true,
    );
  });

  it("summarizes squad buckets", () => {
    const summary = summarizeByMainSquad([
      row("a1", 100, "aircraft"),
      row("a2", 200, "aircraft"),
      row("u1", 50, null),
    ]);
    expect(summary.aircraft.count).toBe(2);
    expect(summary.aircraft.avgThp).toBe(150);
    expect(summary.unreported.count).toBe(1);
  });
});
