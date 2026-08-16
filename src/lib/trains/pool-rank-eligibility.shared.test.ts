import { describe, expect, it } from "vitest";

import {
  isRankEligibilityPoolType,
  planCurrentGenerationRankEligibilitySync,
  type RankPoolEntrySnapshot,
  type RankPoolMemberSnapshot,
} from "@/lib/trains/pool-rank-eligibility.shared";

function entry(
  id: string,
  memberId: string,
  options: {
    selected?: boolean;
    memberName?: string;
    allianceRank?: number | null;
  } = {},
): RankPoolEntrySnapshot {
  return {
    id,
    memberId,
    memberName: options.memberName ?? memberId,
    allianceRank: options.allianceRank ?? null,
    selectedAt: options.selected ? "2026-08-10T12:00:00.000Z" : null,
  };
}

function member(
  memberId: string,
  rank: number | null,
  memberName = memberId,
): RankPoolMemberSnapshot {
  return { memberId, memberName, rank };
}

describe("isRankEligibilityPoolType", () => {
  it("only tracks r3 and r4_plus", () => {
    expect(isRankEligibilityPoolType("r3")).toBe(true);
    expect(isRankEligibilityPoolType("r4_plus")).toBe(true);
    expect(isRankEligibilityPoolType("heavy_hitter")).toBe(false);
    expect(isRankEligibilityPoolType("event_top_x")).toBe(false);
    expect(isRankEligibilityPoolType("all_members")).toBe(false);
  });
});

describe("planCurrentGenerationRankEligibilitySync", () => {
  it("no-ops when the current generation has never been seeded", () => {
    expect(
      planCurrentGenerationRankEligibilitySync({
        poolType: "r4_plus",
        entries: [],
        members: [member("shera", 4, "SheRä")],
      }),
    ).toEqual({
      unselectedEntryIdsToRemove: [],
      membersToAdd: [],
      unselectedNameUpdates: [],
    });
  });

  it("removes an R3 demoted to R2 from the R3 eligibility side", () => {
    const plan = planCurrentGenerationRankEligibilitySync({
      poolType: "r3",
      entries: [
        entry("e-keep", "r3-a", { allianceRank: 3 }),
        entry("e-demote", "was-r3", { allianceRank: 3 }),
        entry("e-chosen", "already-spun", { selected: true, allianceRank: 3 }),
      ],
      members: [
        member("r3-a", 3),
        member("was-r3", 2),
        member("already-spun", 3),
      ],
    });

    expect(plan.unselectedEntryIdsToRemove).toEqual(["e-demote"]);
    expect(plan.membersToAdd).toEqual([]);
    expect(plan.unselectedNameUpdates).toEqual([]);
  });

  it("moves R3→R4 eligibility: drop R3 unselected, add to open R4 unless already chosen", () => {
    const r3Plan = planCurrentGenerationRankEligibilitySync({
      poolType: "r3",
      entries: [
        entry("r3-keep", "still-r3", { allianceRank: 3 }),
        entry("r3-promoted", "promoted", { allianceRank: 3 }),
      ],
      members: [member("still-r3", 3), member("promoted", 4)],
    });
    const r4Plan = planCurrentGenerationRankEligibilitySync({
      poolType: "r4_plus",
      entries: [
        entry("r4-open", "officer-a", { allianceRank: 4 }),
        entry("r4-chosen", "officer-b", { selected: true, allianceRank: 4 }),
      ],
      members: [
        member("officer-a", 4),
        member("officer-b", 4),
        member("promoted", 4),
      ],
    });

    expect(r3Plan.unselectedEntryIdsToRemove).toEqual(["r3-promoted"]);
    expect(r3Plan.membersToAdd).toEqual([]);
    expect(r4Plan.unselectedEntryIdsToRemove).toEqual([]);
    expect(r4Plan.membersToAdd).toEqual([member("promoted", 4)]);
  });

  it("does not add a promoted member who is already on the chosen side of R4", () => {
    const plan = planCurrentGenerationRankEligibilitySync({
      poolType: "r4_plus",
      entries: [
        entry("r4-open", "officer-a", { allianceRank: 4 }),
        entry("r4-chosen", "promoted", { selected: true, allianceRank: 4 }),
      ],
      members: [member("officer-a", 4), member("promoted", 4)],
    });

    expect(plan.membersToAdd).toEqual([]);
    expect(plan.unselectedEntryIdsToRemove).toEqual([]);
  });

  it("moves R4→R3 eligibility: drop R4 unselected, add to open R3 unless already chosen", () => {
    const r4Plan = planCurrentGenerationRankEligibilitySync({
      poolType: "r4_plus",
      entries: [
        entry("r4-keep", "still-r4", { allianceRank: 4 }),
        entry("r4-demoted", "demoted", { allianceRank: 4 }),
      ],
      members: [member("still-r4", 4), member("demoted", 3)],
    });
    const r3Plan = planCurrentGenerationRankEligibilitySync({
      poolType: "r3",
      entries: [
        entry("r3-open", "r3-a", { allianceRank: 3 }),
        entry("r3-chosen", "r3-b", { selected: true, allianceRank: 3 }),
      ],
      members: [member("r3-a", 3), member("r3-b", 3), member("demoted", 3)],
    });

    expect(r4Plan.unselectedEntryIdsToRemove).toEqual(["r4-demoted"]);
    expect(r3Plan.membersToAdd).toEqual([member("demoted", 3)]);
  });

  it("does not refresh R3 eligibility after thrash when the member was already chosen as R3", () => {
    const afterDemotion = planCurrentGenerationRankEligibilitySync({
      poolType: "r3",
      entries: [
        entry("r3-open", "r3-a", { allianceRank: 3 }),
        entry("r3-chosen", "thrasher", { selected: true, allianceRank: 3 }),
      ],
      members: [member("r3-a", 3), member("thrasher", 3)],
    });

    expect(afterDemotion.membersToAdd).toEqual([]);
    expect(afterDemotion.unselectedEntryIdsToRemove).toEqual([]);
  });

  it("does not delete a selected R4 row when that officer is demoted", () => {
    const plan = planCurrentGenerationRankEligibilitySync({
      poolType: "r4_plus",
      entries: [
        entry("r4-open", "still-r4", { allianceRank: 4 }),
        entry("r4-chosen", "demoted", { selected: true, allianceRank: 4 }),
      ],
      members: [member("still-r4", 4), member("demoted", 3)],
    });

    expect(plan.unselectedEntryIdsToRemove).toEqual([]);
    expect(plan.membersToAdd).toEqual([]);
  });

  it("inserts a rank-eligible member missing from an in-progress generation (SheRä)", () => {
    const plan = planCurrentGenerationRankEligibilitySync({
      poolType: "r4_plus",
      entries: [
        entry("r4-1", "stitch", {
          selected: true,
          memberName: "SheRä",
          allianceRank: 4,
        }),
        entry("r4-2", "officer-a", { allianceRank: 5 }),
      ],
      members: [
        member("stitch", 4, "Stitch"),
        member("officer-a", 5, "Officer A"),
        member("shera-new", 4, "SheRä"),
      ],
    });

    expect(plan.unselectedEntryIdsToRemove).toEqual([]);
    expect(plan.membersToAdd).toEqual([member("shera-new", 4, "SheRä")]);
  });

  it("treats R5 as R4+ eligible when inserting into an open generation", () => {
    const plan = planCurrentGenerationRankEligibilitySync({
      poolType: "r4_plus",
      entries: [entry("r4-open", "officer-a", { allianceRank: 4 })],
      members: [member("officer-a", 4), member("leader", 5, "Leader")],
    });

    expect(plan.membersToAdd).toEqual([member("leader", 5, "Leader")]);
  });

  it("does not reopen an exhausted generation for a newly eligible member", () => {
    const plan = planCurrentGenerationRankEligibilitySync({
      poolType: "r4_plus",
      entries: [
        entry("r4-1", "officer-a", { selected: true, allianceRank: 4 }),
        entry("r4-2", "officer-b", { selected: true, allianceRank: 4 }),
      ],
      members: [
        member("officer-a", 4),
        member("officer-b", 4),
        member("shera-new", 4, "SheRä"),
      ],
    });

    expect(plan.membersToAdd).toEqual([]);
  });

  it("does not duplicate a member who is already unselected in the destination pool", () => {
    const plan = planCurrentGenerationRankEligibilitySync({
      poolType: "r4_plus",
      entries: [entry("r4-open", "officer-a", { allianceRank: 4 })],
      members: [member("officer-a", 4)],
    });

    expect(plan.membersToAdd).toEqual([]);
  });

  it("drops unselected rows for members missing from the active roster", () => {
    const plan = planCurrentGenerationRankEligibilitySync({
      poolType: "r3",
      entries: [
        entry("e-keep", "r3-a", { allianceRank: 3 }),
        entry("e-left", "former", { allianceRank: 3 }),
      ],
      members: [member("r3-a", 3)],
    });

    expect(plan.unselectedEntryIdsToRemove).toEqual(["e-left"]);
  });

  it("refreshes frozen name and rank on remaining unselected rows", () => {
    const plan = planCurrentGenerationRankEligibilitySync({
      poolType: "r4_plus",
      entries: [
        entry("e-open", "officer-a", {
          memberName: "OldName",
          allianceRank: 4,
        }),
      ],
      members: [member("officer-a", 5, "NewName")],
    });

    expect(plan.unselectedNameUpdates).toEqual([
      { id: "e-open", memberName: "NewName", allianceRank: 5 },
    ]);
    expect(plan.membersToAdd).toEqual([]);
  });
});
