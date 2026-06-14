import { describe, expect, it } from "vitest";

import {
  buildMemberIndex,
  matchAllNames,
  matchMemberName,
  type AshedMember,
} from "@/lib/video/member-matcher";

const members: AshedMember[] = [
  {
    id: "m1",
    current_name: "Freddy",
    previous_names: ["Fred"],
    status: "active",
  },
  {
    id: "m2",
    current_name: "Bat Pig",
    status: "active",
  },
  {
    id: "m3",
    current_name: "Former Guy",
    status: "former",
  },
];

describe("matchMemberName", () => {
  const index = buildMemberIndex(members);

  it("exact-matches current names", () => {
    const match = matchMemberName("Freddy", index);
    expect(match.memberId).toBe("m1");
    expect(match.matchMethod).toBe("exact");
    expect(match.confidence).toBe(1);
  });

  it("matches previous names", () => {
    const match = matchMemberName("Fred", index);
    expect(match.memberId).toBe("m1");
    expect(match.matchMethod).toBe("previous_name");
  });

  it("strips alliance tags before matching", () => {
    const match = matchMemberName("[LFgo]Freddy", index, {
      allianceTag: "LFgo",
    });
    expect(match.memberId).toBe("m1");
    expect(match.matchMethod).toBe("exact");
  });

  it("fuzzy-matches close OCR names", () => {
    const match = matchMemberName("BatPig", index);
    expect(match.memberId).toBe("m2");
    expect(match.matchMethod).toBe("fuzzy");
  });

  it("handles empty OCR names in fuzzy matching", () => {
    const index = buildMemberIndex(members);
    expect(matchMemberName("", index).matchMethod).toBe("none");
  });
});

describe("matchAllNames", () => {
  it("matches a list of OCR names", () => {
    const results = matchAllNames(["Freddy", "Nope"], members, {
      allianceTag: "LFgo",
    });
    expect(results[0]?.memberId).toBe("m1");
    expect(results[1]?.memberId).toBeNull();
  });
});

describe("buildMemberIndex", () => {
  it("excludes former members from active list", () => {
    const index = buildMemberIndex(members);
    expect(index.active.map((member) => member.id)).not.toContain("m3");
  });

  it("falls back to raw OCR name when stripping leaves nothing matchable", () => {
    const index = buildMemberIndex([
      { id: "m1", current_name: "[LFgo]", status: "active" },
    ]);
    const match = matchMemberName("[LFgo]", index, { allianceTag: "LFgo" });
    expect(match.memberId).toBe("m1");
  });
});
