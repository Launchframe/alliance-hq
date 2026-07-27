import { describe, expect, it } from "vitest";

import {
  buildShortNameMatchRoster,
  SHORT_NAME_MEMBER_MATCH_CASES,
} from "@/lib/video/member-match-short-name.fixtures";
import {
  buildMemberIndex,
  matchAllNames,
  matchMemberName,
  MEMBER_FUZZY_AUTO_MATCH_MIN,
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

describe("short-name member auto-match (shared import + video)", () => {
  const roster = buildShortNameMatchRoster();
  const index = buildMemberIndex(roster);

  it.each(SHORT_NAME_MEMBER_MATCH_CASES)(
    "matchMemberName: $query → $rosterName",
    ({ query, memberId }) => {
      const match = matchMemberName(query, index);
      expect(match.memberId).toBe(memberId);
      expect(match.matchMethod).toBe("fuzzy");
      expect(match.confidence).toBeGreaterThanOrEqual(
        MEMBER_FUZZY_AUTO_MATCH_MIN,
      );
    },
  );

  it("matchAllNames (history import path) resolves every short-name case", () => {
    const results = matchAllNames(
      SHORT_NAME_MEMBER_MATCH_CASES.map((row) => row.query),
      roster,
    );
    expect(results.map((row) => row.memberId)).toEqual(
      SHORT_NAME_MEMBER_MATCH_CASES.map((row) => row.memberId),
    );
  });

  it("does not auto-match when multiple roster names contain the paste", () => {
    const ambiguous = buildMemberIndex([
      { id: "a", current_name: "Happytokill", status: "active" },
      { id: "b", current_name: "HappyDays", status: "active" },
    ]);
    const match = matchMemberName("Happy", ambiguous);
    expect(match.memberId).toBeNull();
    expect(match.matchMethod).toBe("none");
  });

  it("does not auto-match mid-word unique substrings", () => {
    const index = buildMemberIndex([
      { id: "c", current_name: "Crazy", status: "active" },
      { id: "r", current_name: "Redd", status: "active" },
    ]);
    const match = matchMemberName("ra", index);
    expect(match.memberId).toBeNull();
    expect(match.matchMethod).toBe("none");
  });

  it("includeFormer matches leavers and prefers active on conflict", () => {
    const roster: AshedMember[] = [
      { id: "active", current_name: "Happy", status: "active" },
      { id: "former", current_name: "Happytokill", status: "former" },
      { id: "gone", current_name: "Leaver", status: "former" },
    ];
    const withFormer = matchAllNames(["Leaver", "Happy"], roster, {
      includeFormer: true,
    });
    expect(withFormer[0]?.memberId).toBe("gone");
    expect(withFormer[1]?.memberId).toBe("active");

    const activeOnly = matchAllNames(["Leaver"], roster);
    expect(activeOnly[0]?.memberId).toBeNull();
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
