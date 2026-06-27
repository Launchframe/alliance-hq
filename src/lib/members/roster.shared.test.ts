import { describe, expect, it } from "vitest";

import {
  allianceMemberRowToAshedMember,
  normalizedRankFromAshedMember,
} from "@/lib/members/roster.shared";
import { parseAshedMemberAllianceRank } from "@/lib/members/alliance-rank";
import type { AllianceMember } from "@/lib/db/schema";

function rosterRow(overrides: Partial<AllianceMember> = {}): AllianceMember {
  return {
    id: "row1",
    allianceId: "hq1",
    ashedMemberId: "m1",
    ashedAllianceId: "a1",
    currentName: "Alice",
    previousNamesJson: ["OldAlice"],
    status: "active",
    allianceRank: 4,
    allianceRankTitle: "Muse",
    ashedRankRaw: "Muse",
    heroPowerM: null,
    memberLevel: null,
    joinDate: null,
    profession: null,
    professionalLevel: null,
    powerLevel: null,
    currentKills: null,
    currentTotalHeroPower: null,
    notes: null,
    timezone: null,
    recordedDate: null,
    ashedCreatedAt: null,
    ashedUpdatedAt: null,
    currentSquadPowerJson: null,
    squadPowerSnapshotsJson: null,
    mainSquad: null,
    isSample: null,
    gameUid: null,
    commanderSyncStatus: "synced",
    commanderConflictJson: null,
    syncedAt: new Date("2026-06-01T00:00:00Z"),
    createdAt: new Date("2026-06-01T00:00:00Z"),
    updatedAt: new Date("2026-06-01T00:00:00Z"),
    ...overrides,
  };
}

describe("normalizedRankFromAshedMember", () => {
  it("parses bare officer title at sync time", () => {
    expect(normalizedRankFromAshedMember({ rank: "Warlord" })).toEqual({
      allianceRank: 4,
      allianceRankTitle: "Warlord",
      ashedRankRaw: "Warlord",
    });
  });

  it("parses plain R3 strings", () => {
    expect(normalizedRankFromAshedMember({ rank: "R3" })).toEqual({
      allianceRank: 3,
      allianceRankTitle: null,
      ashedRankRaw: "R3",
    });
  });
});

describe("allianceMemberRowToAshedMember", () => {
  it("maps normalized roster fields for UI parsing", () => {
    const member = allianceMemberRowToAshedMember(rosterRow());
    expect(member.id).toBe("m1");
    expect(member.current_name).toBe("Alice");
    expect(member.alliance_rank).toBe(4);
    expect(member.allianceRankTitle).toBe("Muse");
    expect(member.rank).toBe("Muse");
    expect(parseAshedMemberAllianceRank(member)).toEqual({
      rank: 4,
      title: "Muse",
    });
  });

  it("preserves title when alliance_rank is numeric and rank raw is plain R4", () => {
    const member = allianceMemberRowToAshedMember(
      rosterRow({
        allianceRankTitle: "Warlord",
        ashedRankRaw: "R4",
      }),
    );

    expect(parseAshedMemberAllianceRank(member)).toEqual({
      rank: 4,
      title: "Warlord",
    });
  });

  it("maps heroPowerM to total_hero_power", () => {
    const member = allianceMemberRowToAshedMember(
      rosterRow({ heroPowerM: 8.5 }),
    );
    expect(member.total_hero_power).toBe(8_500_000);
  });
});
