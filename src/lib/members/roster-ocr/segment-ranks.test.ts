import { describe, expect, it } from "vitest";

import {
  detectLayout,
  detectTitle,
  isIgnoredLine,
  parseRankHeader,
  segmentByRankHeaders,
} from "@/lib/members/roster-ocr/segment-ranks";

// ---------------------------------------------------------------------------
// isIgnoredLine
// ---------------------------------------------------------------------------

describe("isIgnoredLine", () => {
  it("ignores 'Search for Members'", () => {
    expect(isIgnoredLine("Search for Members")).toBe(true);
  });

  it("ignores 'Manage'", () => {
    expect(isIgnoredLine("Manage")).toBe(true);
  });

  it("ignores 'Online'", () => {
    expect(isIgnoredLine("Online")).toBe(true);
  });

  it("ignores timestamps like '5m ago'", () => {
    expect(isIgnoredLine("5m ago")).toBe(true);
    expect(isIgnoredLine("2h ago")).toBe(true);
    expect(isIgnoredLine("1d ago")).toBe(true);
  });

  it("ignores member count fraction", () => {
    expect(isIgnoredLine("45 / 100")).toBe(true);
  });

  it("does not ignore a normal member name", () => {
    expect(isIgnoredLine("BigDaddy123")).toBe(false);
  });

  it("does not ignore a name with 'online' in it", () => {
    // word boundary — 'online' should match, but 'Donlines' should not
    expect(isIgnoredLine("Donlines")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseRankHeader
// ---------------------------------------------------------------------------

describe("parseRankHeader", () => {
  it("parses 'R1' through 'R5'", () => {
    expect(parseRankHeader("R1")).toBe(1);
    expect(parseRankHeader("R3")).toBe(3);
    expect(parseRankHeader("R5")).toBe(5);
  });

  it("handles whitespace around header", () => {
    expect(parseRankHeader("  R4  ")).toBe(4);
  });

  it("is case-insensitive", () => {
    expect(parseRankHeader("r2")).toBe(2);
  });

  it("returns null for non-header lines", () => {
    expect(parseRankHeader("PlayerName R3")).toBe(null);
    expect(parseRankHeader("R6")).toBe(null);
    expect(parseRankHeader("Warlord")).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// detectTitle
// ---------------------------------------------------------------------------

describe("detectTitle", () => {
  it("detects 'Leader' → rank 5", () => {
    const result = detectTitle("Leader BigDaddy");
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Leader");
    expect(result!.rank).toBe(5);
    expect(result!.remainder).toContain("BigDaddy");
  });

  it("detects 'Warlord' → rank 4", () => {
    const result = detectTitle("Warlord ShadowFox 4.2M");
    expect(result!.title).toBe("Warlord");
    expect(result!.rank).toBe(4);
  });

  it("detects 'Recruiter' → rank 4", () => {
    const result = detectTitle("Recruiter CoolName Lv.85");
    expect(result!.title).toBe("Recruiter");
    expect(result!.rank).toBe(4);
    expect(result!.remainder).toContain("CoolName");
  });

  it("detects 'Muse' → rank 4", () => {
    const result = detectTitle("Muse StarDust");
    expect(result!.title).toBe("Muse");
    expect(result!.rank).toBe(4);
  });

  it("detects 'Butler' → rank 4", () => {
    const result = detectTitle("Butler ServantHero");
    expect(result!.title).toBe("Butler");
    expect(result!.rank).toBe(4);
  });

  it("is case-insensitive for title detection", () => {
    const result = detectTitle("WARLORD BigGuy");
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Warlord");
  });

  it("returns null when no title present", () => {
    expect(detectTitle("RandomPlayer 3.5M Lv.70")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectLayout
// ---------------------------------------------------------------------------

describe("detectLayout", () => {
  it("detects rank_list when R1–R5 headers present", () => {
    const lines = ["R5", "BigLeader", "R4", "Officer1", "Officer2", "R3", "Player1"];
    expect(detectLayout(lines)).toBe("rank_list");
  });

  it("detects officers when titled roles present and no rank headers", () => {
    const lines = ["Leader BigDaddy", "Warlord ShadowFox", "Recruiter StarDust"];
    expect(detectLayout(lines)).toBe("officers");
  });

  it("falls back to rank_list for ambiguous input", () => {
    const lines = ["Player1", "Player2", "Player3"];
    expect(detectLayout(lines)).toBe("rank_list");
  });
});

// ---------------------------------------------------------------------------
// segmentByRankHeaders
// ---------------------------------------------------------------------------

describe("segmentByRankHeaders", () => {
  it("assigns rank context to lines following a header", () => {
    const lines = [
      "Search for Members",
      "R5",
      "BigLeader 8.5M Lv.95",
      "R4",
      "Officer1 4.2M",
      "Officer2",
      "R3",
      "Member1 2.1M",
    ];
    const result = segmentByRankHeaders(lines);

    // Ignored line should be omitted
    expect(result.some((r) => r.line.includes("Search"))).toBe(false);

    // R5 header
    const r5Header = result.find((r) => r.isHeader && r.rank === 5);
    expect(r5Header).toBeDefined();

    // BigLeader should have rank 5
    const leaderRow = result.find((r) => r.line.includes("BigLeader"));
    expect(leaderRow?.rank).toBe(5);

    // Officer1 should have rank 4
    const off1 = result.find((r) => r.line.includes("Officer1"));
    expect(off1?.rank).toBe(4);

    // Member1 should have rank 3
    const mem1 = result.find((r) => r.line.includes("Member1"));
    expect(mem1?.rank).toBe(3);
  });

  it("lines before any header have null rank", () => {
    const lines = ["SomeName 3.0M", "R3", "Player"];
    const result = segmentByRankHeaders(lines);
    const beforeHeader = result.find((r) => r.line.includes("SomeName"));
    expect(beforeHeader?.rank).toBeNull();
  });
});
