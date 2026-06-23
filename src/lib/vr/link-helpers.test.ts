import { describe, expect, it } from "vitest";

import type { AshedMember } from "@/lib/video/member-matcher";

import {
  advanceLinkWalkthrough,
  findExactMemberByName,
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
