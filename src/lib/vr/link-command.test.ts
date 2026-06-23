import { describe, expect, it } from "vitest";

import type { AshedMember } from "@/lib/video/member-matcher";
import { findFuzzyMemberCandidates } from "@/lib/video/member-matcher";

import { processLinkCommand } from "@/lib/vr/link-command";

const translate = (key: string, params?: Record<string, string | number>) => {
  if (key === "link.rosterMissVerified" && params) {
    return `verified:${params.gameName}:${params.tag}`;
  }
  if (key === "link.linked" && params) {
    return `linked:${params.name}`;
  }
  return key;
};

const walkthroughSteps = ["step1"];

describe("processLinkCommand", () => {
  const stitchMember: AshedMember = {
    id: "stitch-id",
    current_name: "Stitch",
    status: "active",
  };
  const mrBellyMember: AshedMember = {
    id: "mr-belly-id",
    current_name: "Mr BELLY",
    status: "active",
  };

  it("links on exact roster match for game-verified name", () => {
    const members: AshedMember[] = [
      { id: "lil-id", current_name: "Lil Belly", status: "active" },
      mrBellyMember,
    ];

    const result = processLinkCommand({
      reportedName: "lil belly",
      gameUid: "1001369694001203",
      lookup: { ok: true, gameUserName: "Lil Belly" },
      members,
      linkedMemberIds: new Set(),
      pending: null,
      translate,
      walkthroughSteps,
      allianceTag: "LFgo",
    });

    expect(result.linked).toBe(true);
    expect(result.linkTarget?.ashedMemberId).toBe("lil-id");
    expect(result.linkTarget?.memberDisplayName).toBe("Lil Belly");
  });

  it("does not fuzzy-link Lil Belly UID to Mr BELLY when roster still shows Stitch", () => {
    const fuzzyWouldMatch = findFuzzyMemberCandidates("lil belly", [
      stitchMember,
      mrBellyMember,
    ]);
    expect(fuzzyWouldMatch.some((row) => row.memberId === mrBellyMember.id)).toBe(
      true,
    );

    const result = processLinkCommand({
      reportedName: "lil belly",
      gameUid: "1001369694001203",
      lookup: { ok: true, gameUserName: "Lil Belly" },
      members: [stitchMember, mrBellyMember],
      linkedMemberIds: new Set(),
      pending: null,
      translate,
      walkthroughSteps,
      allianceTag: "LFgo",
    });

    expect(result.linked).toBeUndefined();
    expect(result.pending).toBeNull();
    expect(result.needsOfficerAttention).toBe(true);
    expect(result.reply).toBe("verified:Lil Belly:LFgo");
  });

  it("matches previous roster names exactly", () => {
    const members: AshedMember[] = [
      {
        id: "renamed-id",
        current_name: "Lil Belly",
        previous_names: ["Stitch"],
        status: "active",
      },
    ];

    const result = processLinkCommand({
      reportedName: "Stitch",
      gameUid: "1001369694001203",
      lookup: { ok: true, gameUserName: "Stitch" },
      members,
      linkedMemberIds: new Set(),
      pending: null,
      translate,
      walkthroughSteps,
    });

    expect(result.linked).toBe(true);
    expect(result.linkTarget?.ashedMemberId).toBe("renamed-id");
  });
});
