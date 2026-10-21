import { describe, expect, it } from "vitest";

import { parsePairingImportText } from "@/lib/professions/pairing-import.shared";
import {
  buildTeamDraft,
  countEngineerRanks,
  formatPairingExport,
  suggestEngineerRatio,
  type TeamBuilderPerson,
  type TeamBuilderRankKey,
} from "@/lib/professions/team-builder.shared";

function person(
  commanderId: string,
  rank: number | null,
  name = commanderId,
): TeamBuilderPerson {
  return { commanderId, name, rank };
}

function engineersOf(rank: number | null, count: number, prefix: string): TeamBuilderPerson[] {
  return Array.from({ length: count }, (_, index) =>
    person(`${prefix}-${index}`, rank, `${prefix} ${index}`),
  );
}

function ranksCloseToShare(
  engineers: TeamBuilderPerson[],
  share: Record<TeamBuilderRankKey, number>,
): void {
  const actual = countEngineerRanks(engineers);
  for (const key of Object.keys(share) as TeamBuilderRankKey[]) {
    expect(Math.abs(actual[key] - share[key])).toBeLessThanOrEqual(1);
  }
}

describe("suggestEngineerRatio", () => {
  it("requires a War Leader", () => {
    expect(suggestEngineerRatio(0, 10)).toEqual({
      ok: false,
      reason: "no_war_leader",
    });
  });

  it("splits a remainder across teams", () => {
    expect(suggestEngineerRatio(10, 23)).toEqual({
      ok: true,
      warLeaders: 10,
      engineers: 23,
      base: 2,
      extra: 3,
    });
  });
});

describe("buildTeamDraft", () => {
  it("spreads 60 R3, 20 R2, and 10 R1 engineers evenly and ignores War Leader rank", () => {
    const engineers = [
      ...engineersOf(3, 60, "r3"),
      ...engineersOf(2, 20, "r2"),
      ...engineersOf(1, 10, "r1"),
    ];
    const lowRankLeaders = Array.from({ length: 10 }, (_, index) =>
      person(`wl-${index}`, 1, `Leader ${String.fromCharCode(65 + index)}`),
    );
    const highRankLeaders = lowRankLeaders.map((leader) => ({
      ...leader,
      rank: 5,
    }));

    const low = buildTeamDraft({
      warLeaders: lowRankLeaders,
      engineers,
      target: 9,
    });
    const high = buildTeamDraft({
      warLeaders: highRankLeaders,
      engineers,
      target: 9,
    });

    expect(low.unplaced).toEqual([]);
    for (const team of low.teams) {
      expect(team.engineers).toHaveLength(9);
      ranksCloseToShare(team.engineers, {
        "1": 1,
        "2": 2,
        "3": 6,
        "4": 0,
        "5": 0,
        unknown: 0,
      });
    }
    expect(low.teams.map((team) => team.engineers.map((eng) => eng.commanderId))).toEqual(
      high.teams.map((team) => team.engineers.map((eng) => eng.commanderId)),
    );
  });

  it("gives every team a share of engineers with no rank", () => {
    const engineers = [
      ...engineersOf(3, 60, "r3"),
      ...engineersOf(2, 20, "r2"),
      ...engineersOf(1, 10, "r1"),
      ...engineersOf(null, 10, "unk"),
    ];
    const warLeaders = Array.from({ length: 10 }, (_, index) =>
      person(`wl-${index}`, 4, `Leader ${index}`),
    );
    const draft = buildTeamDraft({
      warLeaders,
      engineers,
      target: 10,
    });
    expect(draft.unplaced).toEqual([]);
    for (const team of draft.teams) {
      expect(team.engineers).toHaveLength(10);
      expect(countEngineerRanks(team.engineers).unknown).toBe(1);
    }
  });

  it("gives remainder teams one more engineer at the suggested base", () => {
    const engineers = engineersOf(3, 23, "eng");
    const warLeaders = Array.from({ length: 10 }, (_, index) =>
      person(`wl-${index}`, null, `Leader ${String(index).padStart(2, "0")}`),
    );
    const draft = buildTeamDraft({
      warLeaders,
      engineers,
      target: 2,
    });
    const sizes = draft.teams.map((team) => team.engineers.length).sort((a, b) => a - b);
    expect(sizes).toEqual([2, 2, 2, 2, 2, 2, 2, 3, 3, 3]);
    expect(draft.unplaced).toEqual([]);
  });

  it("leaves engineers unplaced when the officer lowers the target", () => {
    const draft = buildTeamDraft({
      warLeaders: [person("wl-a", 5, "Alpha"), person("wl-b", 5, "Bravo")],
      engineers: [
        person("e1", 1, "Eng 1"),
        person("e2", 1, "Eng 2"),
        person("e3", 3, "Eng 3"),
        person("e4", 3, "Eng 4"),
      ],
      target: 1,
    });
    expect(draft.teams.every((team) => team.engineers.length === 1)).toBe(true);
    expect(draft.unplaced).toHaveLength(2);
    const seated = draft.teams.flatMap((team) => team.engineers);
    expect(new Set(seated.map((eng) => eng.rank)).size).toBe(2);
  });

  it("puts every engineer aside when there is no War Leader", () => {
    const engineers = [person("e1", 2, "Eng")];
    const draft = buildTeamDraft({ warLeaders: [], engineers, target: 2 });
    expect(draft.teams).toEqual([]);
    expect(draft.unplaced.map((eng) => eng.commanderId)).toEqual(["e1"]);
  });
});

describe("formatPairingExport", () => {
  it("round-trips through the pairing importer", () => {
    const text = formatPairingExport([
      { wlName: "Nova", engineerNames: ["Freddy", "Sie"] },
      { wlName: "Empty", engineerNames: [] },
      { wlName: "Alpha", engineerNames: ["Zed", "Mia"] },
    ]);
    const lines = parsePairingImportText(text);
    expect(lines.map((line) => line.issue)).toEqual([undefined, undefined]);
    expect(lines.map((line) => line.wlRaw)).toEqual(["Alpha", "Nova"]);
    expect(lines.map((line) => line.engRemainder)).toEqual([
      "Mia Zed",
      "Freddy Sie",
    ]);
  });
});
