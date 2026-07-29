import { describe, expect, it } from "vitest";

import {
  detectLayout,
  detectTitle,
  isIgnoredLine,
  isRankGroupHeaderLine,
  parseRankGroupHeader,
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

  it("does not ignore a name that only contains a trailing timestamp token", () => {
    // Whole-line ignore is for chrome; name+timestamp is cleaned in parse-rows.
    expect(isIgnoredLine("Nobell 1h ago")).toBe(false);
  });

  it("ignores officer title chrome rows", () => {
    expect(isIgnoredLine("Recruiter Muse Butler")).toBe(true);
    expect(isIgnoredLine("Warlord")).toBe(true);
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

  it("parses section headers with quota counts", () => {
    expect(parseRankHeader("R3 9/78")).toBe(3);
    expect(parseRankHeader("R4 0/10")).toBe(4);
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

  it("forces rank_list when Search for Members is present", () => {
    const lines = [
      "Warlord",
      "Recruiter",
      "Search for Members",
      "R3 9/78",
      "Player1",
    ];
    expect(detectLayout(lines)).toBe("rank_list");
  });

  it("uses rank_list when any R-section header is present", () => {
    const lines = ["Warlord ShadowFox", "R3", "Player1"];
    expect(detectLayout(lines)).toBe("rank_list");
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

  it("treats custom rank group title + quota as header, not member context", () => {
    const lines = [
      "R3",
      "Heart of the Alliance 7/83",
      "C Price",
      "Power: 94.1M Lv.26",
    ];
    const result = segmentByRankHeaders(lines);

    const titleLine = result.find((r) =>
      r.line.includes("Heart of the Alliance"),
    );
    expect(titleLine?.isHeader).toBe(true);

    const memberLine = result.find((r) => r.line.includes("C Price"));
    expect(memberLine?.isHeader).toBe(false);
    expect(memberLine?.rank).toBe(3);
  });

  it("treats OCR-split header (badge then title) as header chrome", () => {
    const lines = ["R3 7/83", "Heart of the Alliance (v", "C Price"];
    const result = segmentByRankHeaders(lines);

    expect(
      result.find((r) => r.line.includes("Heart of the Alliance"))?.isHeader,
    ).toBe(true);
    expect(result.find((r) => r.line.includes("C Price"))?.isHeader).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// parseRankGroupHeader
// ---------------------------------------------------------------------------

describe("parseRankGroupHeader", () => {
  it("parses bare badge and combined badge+title+quota", () => {
    expect(parseRankGroupHeader("R3")?.rank).toBe(3);
    expect(parseRankGroupHeader("R3 Heart of the Alliance 7/83")?.groupTitle).toBe(
      "Heart of the Alliance",
    );
  });

  it("parses title+quota after bare badge context", () => {
    const header = parseRankGroupHeader("Heart of the Alliance 7/83", {
      afterRankBadge: true,
      badgeRank: 3,
    });
    expect(header?.rank).toBe(3);
    expect(header?.groupTitle).toContain("Heart of the Alliance");
  });

  it("parses title-only continuation after bare badge", () => {
    const header = parseRankGroupHeader("Heart of the Alliance (v", {
      afterRankBadge: true,
      badgeRank: 3,
    });
    expect(header?.rank).toBe(3);
    expect(isRankGroupHeaderLine("Heart of the Alliance (v", {
      afterRankBadge: true,
      badgeRank: 3,
    })).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Real-world OCR strings captured from jobs _PUUrjOcByVE3qSc and
  // dtSB32xtMr39bpHH (post-#456 regression) — combined badge+title lines
  // with NO quota digits ever captured.
  // -------------------------------------------------------------------------

  it("parses a combined badge+title line with no quota and trailing chevron garbage", () => {
    const header = parseRankGroupHeader("R3 Heart of the Alliance (wv |");
    expect(header?.rank).toBe(3);
    expect(header?.groupTitle).toBe("Heart of the Alliance");
  });

  it("parses a combined badge+garbage-title line with no quota", () => {
    const header = parseRankGroupHeader("R3) on M");
    expect(header?.rank).toBe(3);
  });

  it("tolerates leading OCR bracket noise before the badge", () => {
    const header = parseRankGroupHeader("[R4 Crowd Control 14/10 (|");
    expect(header?.rank).toBe(4);
    expect(header?.groupTitle).toBe("Crowd Control");
  });

  it("preserves letter v inside group titles when stripping chevron garbage", () => {
    expect(parseRankGroupHeader("R3 Vanguard (wv |")?.groupTitle).toBe("Vanguard");
    expect(parseRankGroupHeader("R4 Invaders 7/83")?.groupTitle).toBe("Invaders");
  });

  it("does not treat a real username with no separator after the digit as a header", () => {
    expect(parseRankGroupHeader("R3Ace")).toBeNull();
  });

  it("does not treat a badge+stats merged line as a header", () => {
    expect(parseRankGroupHeader("R3 SomePlayer 94.1M Lv.26")).toBeNull();
  });

  it("does not treat a member row after a combined header as title continuation", () => {
    expect(
      parseRankGroupHeader("| urmom90 Online", {
        afterRankGroupHeader: true,
        currentRank: 4,
      }),
    ).toBeNull();
  });

  it("parses maintainer screenshot headers with quota on the same line", () => {
    expect(parseRankGroupHeader("R4 Crowd Control 4/10")?.rank).toBe(4);
    expect(parseRankGroupHeader("R4 Crowd Control 4/10")?.groupTitle).toBe(
      "Crowd Control",
    );
    expect(parseRankGroupHeader("R3 Heart of the Alliance 8/83")?.groupTitle).toBe(
      "Heart of the Alliance",
    );
  });

  // -------------------------------------------------------------------------
  // Real Steel pass 2 (Sonnet): LOOSE_RANK_BADGE_LINE_RE regressed member rows
  // whose own rank-badge icon glues onto the name ("R5|BigLeader"), exactly
  // the pattern RANK_BADGE_PREFIX_RE in parse-rows.ts was already designed to
  // strip, whenever that member's Power/Lv stats land on a separate line.
  // -------------------------------------------------------------------------

  it("does not treat a same-rank badge-prefixed member row as a new header", () => {
    // Section already established as rank 5 — "R5|BigLeader" is a member row
    // with a glued badge icon, not a duplicate section header.
    expect(
      parseRankGroupHeader("R5|BigLeader", { currentRank: 5 }),
    ).toBeNull();
    expect(
      parseRankGroupHeader("R3| Ace Ventura", { currentRank: 3 }),
    ).toBeNull();
  });

  it("still treats a same-line badge+title as a header when the rank differs from the established section", () => {
    // Scrolling from the R4 section into a new R3 section — different digit,
    // so this is a genuine new header, not a member row.
    const header = parseRankGroupHeader("R3 Heart of the Alliance (wv |", {
      currentRank: 4,
    });
    expect(header?.rank).toBe(3);
  });

  it("still treats a same-line badge+title as a header when no rank context exists yet", () => {
    // No ctx at all (or ctx.currentRank undefined) — first header in the frame.
    expect(parseRankGroupHeader("R5|BigLeader")?.rank).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Shield badge + quota structural headers (alliance-set custom titles)
// ---------------------------------------------------------------------------

describe("parseRankGroupHeader — shield + quota structure", () => {
  it("matches on shield badge + quota regardless of the custom title text", () => {
    // "Timeout" is alliance-set free text, never a keyword.
    const header = parseRankGroupHeader("R1 Timeout 0/1");
    expect(header?.rank).toBe(1);
    expect(header?.groupTitle).toBe("Timeout");
  });

  it("matches a blank custom title (badge + quota only, with OCR punctuation)", () => {
    // This alliance left its R2 group title empty.
    const header = parseRankGroupHeader("R2) 0/4");
    expect(header?.rank).toBe(2);
    expect(header?.groupTitle).toBeUndefined();
  });

  it("treats a garbled badge digit + quota as a header with unknown rank", () => {
    // Job PwbbPR7NgQOnni3F frame 39: R1/R2 shield OCR'd as "Ra".
    const header = parseRankGroupHeader("Ra) Timeout 0/1", { currentRank: 3 });
    expect(header).not.toBeNull();
    expect(header?.rank).toBeNull();
    expect(header?.groupTitle).toBe("Timeout");
  });

  it("maps an OCR'd 'RS' shield to rank 5", () => {
    const header = parseRankGroupHeader("RS Vanguard 1/1");
    expect(header?.rank).toBe(5);
    expect(header?.groupTitle).toBe("Vanguard");
  });

  it("wins over the same-rank member-row guard when a quota is present", () => {
    // The same section header re-appears across overlapping scroll frames
    // while its rank is already sticky — quota makes it a header regardless.
    const header = parseRankGroupHeader("R3 Heart of the Alliance 7/83", {
      currentRank: 3,
    });
    expect(header?.rank).toBe(3);
  });

  it("never matches member names starting with R and lacking a badge separator", () => {
    expect(parseRankGroupHeader("Rambo")).toBeNull();
    expect(parseRankGroupHeader("Rat King 0/1")).toBeNull();
    expect(parseRankGroupHeader("R2D2 fan club")).toBeNull();
  });

  it("does not ignore 'Timeout' via a fixed denylist (could be a member name)", () => {
    expect(isIgnoredLine("Timeout")).toBe(false);
  });
});

describe("segmentByRankHeaders — garbled-badge headers", () => {
  it("marks a garbled-badge quota line as a header and clears rank context", () => {
    const segmented = segmentByRankHeaders([
      "R3 Heart of the Alliance 7/83",
      "Alice",
      "Ra) Timeout 0/1",
    ]);
    expect(segmented[0]).toMatchObject({ isHeader: true, rank: 3 });
    expect(segmented[1]).toMatchObject({ isHeader: false, rank: 3 });
    expect(segmented[2]).toMatchObject({ isHeader: true, rank: null });
  });
});
