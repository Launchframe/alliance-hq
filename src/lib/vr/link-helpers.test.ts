import { describe, expect, it } from "vitest";

import type { AshedMember } from "@/lib/video/member-matcher";

import {
  advanceLinkWalkthrough,
  findExactMemberByName,
  findUniqueSubstringRosterCandidate,
} from "@/lib/vr/link-helpers";

const steps = ["Open the game.", "Copy your name.", "Run /link again."];
const translate = (key: string) => key;

describe("findExactMemberByName", () => {
  const members: AshedMember[] = [
    {
      id: "m1",
      current_name: "Stitch",
      previous_names: ["Old Stitch"],
      status: "active",
    },
    { id: "m2", current_name: "Mr BELLY", status: "active" },
  ];

  it("matches current roster name case-insensitively", () => {
    expect(findExactMemberByName(members, "mr belly")?.id).toBe("m2");
  });

  it("matches previous roster names", () => {
    expect(findExactMemberByName(members, "Old Stitch")?.id).toBe("m1");
  });

  it("returns null when only a fuzzy neighbor exists", () => {
    expect(findExactMemberByName(members, "Lil Belly")).toBeNull();
  });
});

describe("findUniqueSubstringRosterCandidate", () => {
  const members: AshedMember[] = [
    { id: "m1", current_name: "Mew", status: "active" },
    { id: "m2", current_name: "Stitch", status: "active" },
  ];

  it("suggests the single roster member contained in the game name", () => {
    const result = findUniqueSubstringRosterCandidate(members, "Mew2407");
    expect(result?.ashedMemberId).toBe("m1");
    expect(result?.memberName).toBe("Mew");
    expect(result?.matchedRosterName).toBe("Mew");
    expect(result?.method).toBe("substring");
  });

  it("suggests when the roster name contains the game name", () => {
    const roster: AshedMember[] = [
      { id: "m9", current_name: "Stitch626", status: "active" },
    ];
    expect(
      findUniqueSubstringRosterCandidate(roster, "Stitch")?.ashedMemberId,
    ).toBe("m9");
  });

  it("rejects verified game names shorter than the minimum", () => {
    const roster: AshedMember[] = [
      { id: "m3", current_name: "Mewtwo", status: "active" },
    ];
    // Needle "Mew" is only 3 chars, under the needle floor.
    expect(findUniqueSubstringRosterCandidate(roster, "Mew")).toBeNull();
  });

  it("rejects roster names shorter than the roster floor", () => {
    const roster: AshedMember[] = [
      { id: "m4", current_name: "Bo", status: "active" },
    ];
    expect(
      findUniqueSubstringRosterCandidate(roster, "Bo2407"),
    ).toBeNull();
  });

  it("returns null when more than one member matches", () => {
    const roster: AshedMember[] = [
      { id: "m5", current_name: "Mewtwo", status: "active" },
      { id: "m6", current_name: "Mewthree", status: "active" },
    ];
    expect(findUniqueSubstringRosterCandidate(roster, "Mewt")).toBeNull();
  });

  it("ignores former members", () => {
    const roster: AshedMember[] = [
      { id: "m7", current_name: "Mew", status: "former" },
    ];
    expect(findUniqueSubstringRosterCandidate(roster, "Mew2407")).toBeNull();
  });

  it("considers previous names but dedupes by member", () => {
    const roster: AshedMember[] = [
      {
        id: "m8",
        current_name: "Mewtwo",
        previous_names: ["Mew"],
        status: "active",
      },
    ];
    const result = findUniqueSubstringRosterCandidate(roster, "Mew2407");
    expect(result?.ashedMemberId).toBe("m8");
    expect(result?.matchedRosterName).toBe("Mew");
  });

  it("returns null when nothing is contained", () => {
    expect(
      findUniqueSubstringRosterCandidate(members, "Charizard"),
    ).toBeNull();
  });
});

describe("advanceLinkWalkthrough", () => {
  it("moves the arrow to the next step", () => {
    const result = advanceLinkWalkthrough({ step: 0, translate, steps });
    expect(result.pending).toEqual({ kind: "link_walkthrough", step: 1 });
    expect(result.reply).toContain("→ Copy your name.");
    expect(result.reply).not.toContain("→ Open the game.");
  });

  it("clears pending after the final step", () => {
    const result = advanceLinkWalkthrough({ step: 2, translate, steps });
    expect(result.pending).toBeNull();
    expect(result.reply).toBe("link.walkthroughDone");
  });
});
