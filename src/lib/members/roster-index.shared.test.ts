import { describe, expect, it } from "vitest";

import type { CommanderIndexRow } from "@/lib/commanders/index.shared";
import type { AshedMember } from "@/lib/video/member-matcher";
import {
  defaultRosterColumnVisibility,
  mergeMembersWithCommanderIndex,
  rosterRowMatchesCommanderFilters,
  rosterRowTotalHeroPower,
  sortRosterRows,
  visibleRosterColumns,
} from "@/lib/members/roster-index.shared";

function member(id: string, name: string, overrides: Partial<AshedMember> = {}): AshedMember {
  return {
    id,
    current_name: name,
    ...overrides,
  };
}

function commanderRow(
  ashedMemberId: string,
  overrides: Partial<CommanderIndexRow> = {},
): CommanderIndexRow {
  return {
    ashedMemberId,
    memberName: overrides.memberName ?? ashedMemberId,
    allianceRank: null,
    allianceRankTitle: null,
    totalHeroPower: 1_000_000,
    mainSquad: null,
    mainSquadSource: null,
    highestBaseVr: null,
    hqLinked: false,
    oauthIdentitySplit: false,
    ...overrides,
  };
}

describe("defaultRosterColumnVisibility", () => {
  it("shows officer-only columns when canWrite", () => {
    expect(
      defaultRosterColumnVisibility({ canWrite: true, showSquadEdit: false }),
    ).toMatchObject({
      name: true,
      previousNames: true,
      thp: true,
      squadEdit: false,
    });
  });

  it("hides squad edit unless self-report or officer edit is allowed", () => {
    expect(
      defaultRosterColumnVisibility({ canWrite: false, showSquadEdit: true }),
    ).toMatchObject({
      previousNames: false,
      squadEdit: true,
    });
  });
});

describe("mergeMembersWithCommanderIndex", () => {
  it("joins on ashed member id", () => {
    const merged = mergeMembersWithCommanderIndex(
      [member("m1", "Alpha"), member("m2", "Beta")],
      [commanderRow("m1", { totalHeroPower: 4_500_000 })],
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]?.commander?.totalHeroPower).toBe(4_500_000);
    expect(merged[1]?.commander).toBeNull();
  });
});

describe("rosterRowTotalHeroPower", () => {
  it("prefers commander THP when present", () => {
    const row = mergeMembersWithCommanderIndex(
      [member("m1", "Alpha", { total_hero_power: 100 })],
      [commanderRow("m1", { totalHeroPower: 9_000_000 })],
    )[0]!;
    expect(rosterRowTotalHeroPower(row)).toBe(9_000_000);
  });
});

describe("rosterRowMatchesCommanderFilters", () => {
  const baseRow = mergeMembersWithCommanderIndex(
    [member("m1", "Alpha")],
    [
      commanderRow("m1", {
        mainSquad: "tank",
        totalHeroPower: 5_000_000,
        hqLinked: true,
      }),
    ],
  )[0]!;

  it("filters by squad, THP, and HQ link", () => {
    expect(
      rosterRowMatchesCommanderFilters(baseRow, {
        filterSquad: "tank",
        filterHqLink: "linked",
        filterMinThp: 4_000_000,
        includeUnreported: true,
      }),
    ).toBe(true);

    expect(
      rosterRowMatchesCommanderFilters(baseRow, {
        filterSquad: "aircraft",
        filterHqLink: "all",
        filterMinThp: 0,
        includeUnreported: true,
      }),
    ).toBe(false);

    expect(
      rosterRowMatchesCommanderFilters(baseRow, {
        filterSquad: "",
        filterHqLink: "not_linked",
        filterMinThp: 0,
        includeUnreported: true,
      }),
    ).toBe(false);
  });

  it("excludes unreported squads when includeUnreported is false", () => {
    const unreported = mergeMembersWithCommanderIndex(
      [member("m2", "Beta")],
      [commanderRow("m2", { mainSquad: null })],
    )[0]!;
    expect(
      rosterRowMatchesCommanderFilters(unreported, {
        filterSquad: "",
        filterHqLink: "all",
        filterMinThp: 0,
        includeUnreported: false,
      }),
    ).toBe(false);
  });
});

describe("sortRosterRows", () => {
  it("sorts by THP descending", () => {
    const rows = mergeMembersWithCommanderIndex(
      [member("a", "A"), member("b", "B")],
      [
        commanderRow("a", { totalHeroPower: 1_000 }),
        commanderRow("b", { totalHeroPower: 9_000 }),
      ],
    );
    const sorted = sortRosterRows(rows, "thp", "desc");
    expect(sorted.map((row) => row.ashedMemberId)).toEqual(["b", "a"]);
  });
});

describe("visibleRosterColumns", () => {
  it("returns only enabled columns in registry order", () => {
    const visibility = defaultRosterColumnVisibility({
      canWrite: false,
      showSquadEdit: false,
    });
    expect(visibleRosterColumns(visibility)).toContain("name");
    expect(visibleRosterColumns(visibility)).not.toContain("previousNames");
  });
});
