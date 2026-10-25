import { describe, expect, it } from "vitest";

import {
  chooseRosterDuplicateKeeper,
  groupRosterDuplicates,
  reviewMergePairs,
  selectionIncludesAmbiguous,
  type RosterDuplicateCandidate,
} from "@/lib/members/roster-duplicate-groups.shared";

function member(
  partial: Partial<RosterDuplicateCandidate> &
    Pick<RosterDuplicateCandidate, "ashedMemberId" | "name">,
): RosterDuplicateCandidate {
  return {
    synthetic: false,
    linkedAccount: false,
    hasGameUid: false,
    createdAt: 0,
    ...partial,
  };
}

describe("chooseRosterDuplicateKeeper", () => {
  it("keeps the thin real Ashed row over an older linked LastRank row", () => {
    const keeper = chooseRosterDuplicateKeeper([
      member({
        ashedMemberId: "last-rank",
        name: "Harbor Twin",
        synthetic: true,
        linkedAccount: true,
        hasGameUid: true,
        createdAt: Date.parse("2026-10-08T07:05:00.000Z"),
      }),
      member({
        ashedMemberId: "ashed",
        name: "Harbor Twin",
        synthetic: false,
        createdAt: Date.parse("2026-10-24T00:38:00.000Z"),
      }),
    ]);
    expect(keeper).toBe("ashed");
  });

  it("uses the link, then a game UID, then the older row when both are synthetic", () => {
    expect(
      chooseRosterDuplicateKeeper([
        member({
          ashedMemberId: "plain",
          name: "A",
          synthetic: true,
          createdAt: 1,
        }),
        member({
          ashedMemberId: "linked",
          name: "A",
          synthetic: true,
          linkedAccount: true,
          createdAt: 2,
        }),
      ]),
    ).toBe("linked");

    expect(
      chooseRosterDuplicateKeeper([
        member({
          ashedMemberId: "newer-uid",
          name: "A",
          synthetic: true,
          hasGameUid: true,
          createdAt: 20,
        }),
        member({
          ashedMemberId: "older",
          name: "A",
          synthetic: true,
          createdAt: 10,
        }),
      ]),
    ).toBe("newer-uid");

    expect(
      chooseRosterDuplicateKeeper([
        member({ ashedMemberId: "newer", name: "A", synthetic: true, createdAt: 20 }),
        member({ ashedMemberId: "older", name: "A", synthetic: true, createdAt: 10 }),
      ]),
    ).toBe("older");
  });
});

describe("groupRosterDuplicates", () => {
  it("treats punctuation-only differences as the same name", () => {
    const { groups } = groupRosterDuplicates([
      member({ ashedMemberId: "a", name: "Nico-Pell", synthetic: true, createdAt: 1 }),
      member({ ashedMemberId: "b", name: "Nico Pell", createdAt: 2 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      kind: "exact",
      keeperAshedMemberId: "b",
    });
  });

  it("flags one-character and contained names for review, and clusters of three as ambiguous", () => {
    const { groups, unmatchedSyntheticIds } = groupRosterDuplicates([
      member({ ashedMemberId: "short", name: "Aleeaaaa", synthetic: true, createdAt: 1 }),
      member({ ashedMemberId: "long", name: "Aleeaaaaa", createdAt: 2 }),
      member({ ashedMemberId: "inner", name: "Gennysaur", synthetic: true, createdAt: 1 }),
      member({ ashedMemberId: "outer", name: "QMOX Gennysaur", createdAt: 2 }),
      member({ ashedMemberId: "h1", name: "Harborstone", synthetic: true, createdAt: 1 }),
      member({ ashedMemberId: "h2", name: "Harborston", createdAt: 2 }),
      member({ ashedMemberId: "h3", name: "Harborstona", createdAt: 3 }),
      member({ ashedMemberId: "solo", name: "Solo LastRank", synthetic: true, createdAt: 1 }),
      member({ ashedMemberId: "ashed-only", name: "Only Ashed", createdAt: 2 }),
      member({ ashedMemberId: "tiny-a", name: "Abc", synthetic: true, createdAt: 1 }),
      member({ ashedMemberId: "tiny-b", name: "Abcd", createdAt: 2 }),
    ]);

    const byKind = (kind: string) => groups.filter((group) => group.kind === kind);
    expect(byKind("review").map((group) => [...group.memberIds].sort())).toEqual([
      ["inner", "outer"],
      ["long", "short"],
    ]);
    expect(byKind("review").every((group) => group.keeperAshedMemberId)).toBe(true);
    expect(byKind("ambiguous")).toEqual([
      expect.objectContaining({
        keeperAshedMemberId: null,
        memberIds: ["h1", "h2", "h3"],
      }),
    ]);
    expect(unmatchedSyntheticIds).toEqual(["solo", "tiny-a"]);
    expect(unmatchedSyntheticIds).not.toContain("ashed-only");
    expect(groups.some((group) => group.memberIds.includes("tiny-b"))).toBe(false);
  });

  it("recommends the Ashed keeper for a Caos-sized list of exact pairs", () => {
    const members: RosterDuplicateCandidate[] = [];
    for (let index = 0; index < 73; index += 1) {
      members.push(
        member({
          ashedMemberId: `lr-${index}`,
          name: `Caos Exact ${index}`,
          synthetic: true,
          linkedAccount: index === 0,
          createdAt: Date.parse("2026-10-08T07:05:00.000Z") + index,
        }),
        member({
          ashedMemberId: `as-${index}`,
          name: `Caos Exact ${index}`,
          createdAt: Date.parse("2026-10-24T00:38:00.000Z") + index,
        }),
      );
    }
    members.push(
      member({ ashedMemberId: "short", name: "Aleeaaaa", synthetic: true, createdAt: 1 }),
      member({ ashedMemberId: "long", name: "Aleeaaaaa", createdAt: 2 }),
      member({ ashedMemberId: "inner", name: "Gennysaur", synthetic: true, createdAt: 1 }),
      member({ ashedMemberId: "outer", name: "QMOX Gennysaur", createdAt: 2 }),
      member({ ashedMemberId: "solo", name: "Solo LastRank", synthetic: true, createdAt: 1 }),
      member({ ashedMemberId: "ashed-only", name: "Only Ashed", createdAt: 2 }),
    );

    const { groups, unmatchedSyntheticIds } = groupRosterDuplicates(members);
    const exact = groups.filter((group) => group.kind === "exact");
    expect(exact).toHaveLength(73);
    expect(exact.every((group) => group.keeperAshedMemberId?.startsWith("as-"))).toBe(
      true,
    );
    expect(groups.filter((group) => group.kind === "review")).toHaveLength(2);
    expect(unmatchedSyntheticIds).toEqual(["solo"]);
  });
});

describe("review confirmation", () => {
  const groups = groupRosterDuplicates([
    member({ ashedMemberId: "short", name: "Aleeaaaa", synthetic: true, createdAt: 1 }),
    member({ ashedMemberId: "long", name: "Aleeaaaaa", createdAt: 2 }),
    member({ ashedMemberId: "h1", name: "Harborstone", synthetic: true, createdAt: 1 }),
    member({ ashedMemberId: "h2", name: "Harborston", createdAt: 2 }),
    member({ ashedMemberId: "h3", name: "Harborstona", createdAt: 3 }),
  ]).groups;
  const names = new Map([
    ["short", "Aleeaaaa"],
    ["long", "Aleeaaaaa"],
    ["h1", "Harborstone"],
    ["h2", "Harborston"],
    ["h3", "Harborstona"],
  ]);

  it("lists review fold-ins and rejects any ambiguous selection", () => {
    expect(reviewMergePairs(groups, names, new Set(["short"]))).toEqual([
      { keeperName: "Aleeaaaaa", duplicateName: "Aleeaaaa" },
    ]);
    expect(reviewMergePairs(groups, names, new Set(["long"]))).toEqual([]);
    expect(selectionIncludesAmbiguous(groups, new Set(["h2"]))).toBe(true);
    expect(selectionIncludesAmbiguous(groups, new Set(["short"]))).toBe(false);
  });
});
