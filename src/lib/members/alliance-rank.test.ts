import { describe, expect, it } from "vitest";

import {
  formatAllianceRankLabel,
  formatAshedMemberRankValue,
  formatMemberRankDisplay,
  parseAshedAllianceRankRaw,
  parseAshedMemberAllianceRank,
  readAshedMemberAllianceRank,
} from "@/lib/members/alliance-rank";

describe("parseAshedAllianceRankRaw", () => {
  it("reads plain and numeric ranks", () => {
    expect(parseAshedAllianceRankRaw(4)).toEqual({ rank: 4, title: null });
    expect(parseAshedAllianceRankRaw("R4")).toEqual({ rank: 4, title: null });
    expect(parseAshedAllianceRankRaw("3")).toEqual({ rank: 3, title: null });
  });

  it("parses bare R4 officer titles from Ashed API", () => {
    expect(parseAshedAllianceRankRaw("Muse")).toEqual({
      rank: 4,
      title: "Muse",
    });
    expect(parseAshedAllianceRankRaw("warlord")).toEqual({
      rank: 4,
      title: "Warlord",
    });
    expect(parseAshedAllianceRankRaw("Recruiter")).toEqual({
      rank: 4,
      title: "Recruiter",
    });
  });

  it("parses compound title strings when present", () => {
    expect(parseAshedAllianceRankRaw("Muse (R4)")).toEqual({
      rank: 4,
      title: "Muse",
    });
    expect(parseAshedAllianceRankRaw("Warlord (R4)")).toEqual({
      rank: 4,
      title: "Warlord",
    });
  });

  it("parses R5 leader title formats", () => {
    expect(parseAshedAllianceRankRaw("Leader")).toEqual({
      rank: 5,
      title: "Leader",
    });
    expect(parseAshedAllianceRankRaw("R5 (Leader)")).toEqual({
      rank: 5,
      title: "Leader",
    });
  });

  it("returns nulls for missing or invalid values", () => {
    expect(parseAshedAllianceRankRaw("")).toEqual({ rank: null, title: null });
    expect(parseAshedAllianceRankRaw("R6")).toEqual({ rank: null, title: null });
  });
});

describe("readAshedMemberAllianceRank", () => {
  it("returns rank only for legacy callers", () => {
    expect(readAshedMemberAllianceRank({ rank: "Muse" })).toBe(4);
    expect(readAshedMemberAllianceRank({ rank: "Muse (R4)" })).toBe(4);
    expect(readAshedMemberAllianceRank({ rank: "Leader" })).toBe(5);
  });
});

describe("parseAshedMemberAllianceRank", () => {
  it("maps member.rank strings to rank + title", () => {
    expect(parseAshedMemberAllianceRank({ rank: "Butler" })).toEqual({
      rank: 4,
      title: "Butler",
    });
    expect(parseAshedMemberAllianceRank({ rank: "Recruiter (R4)" })).toEqual({
      rank: 4,
      title: "Recruiter",
    });
  });
});

describe("formatAshedMemberRankValue", () => {
  it("writes Ashed Member.rank values", () => {
    expect(formatAshedMemberRankValue(4)).toBe("R4");
    expect(formatAshedMemberRankValue(4, "Butler")).toBe("Butler");
    expect(formatAshedMemberRankValue(5, "Leader")).toBe("Leader");
    expect(formatAshedMemberRankValue(5)).toBe("R5");
  });
});

describe("formatAllianceRankLabel", () => {
  it("formats R1–R5", () => {
    expect(formatAllianceRankLabel(4)).toBe("R4");
    expect(formatAllianceRankLabel(null)).toBeNull();
  });
});

describe("formatMemberRankDisplay", () => {
  it("separates rank label and title for the members table", () => {
    expect(
      formatMemberRankDisplay({ rank: 4, title: "Muse" }, "—"),
    ).toEqual({
      rankLabel: "R4",
      titleLabel: "Muse",
    });
    expect(formatMemberRankDisplay({ rank: 4, title: null }, "—")).toEqual({
      rankLabel: "R4",
      titleLabel: "—",
    });
  });
});
