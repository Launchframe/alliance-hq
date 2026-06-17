import { describe, expect, it } from "vitest";

import {
  parseLineTokens,
  parseOfficersRows,
  parseRankListRows,
  parseRosterRows,
} from "@/lib/members/roster-ocr/parse-rows";

// ---------------------------------------------------------------------------
// parseLineTokens
// ---------------------------------------------------------------------------

describe("parseLineTokens", () => {
  it("extracts hero power in M format", () => {
    const result = parseLineTokens("BigDaddy 4.2M");
    expect(result.heroPowerM).toBeCloseTo(4.2);
    expect(result.extractedName).toBe("BigDaddy");
  });

  it("extracts whole-number power", () => {
    const result = parseLineTokens("ShadowFox 12M");
    expect(result.heroPowerM).toBe(12);
  });

  it("extracts member level Lv.N", () => {
    const result = parseLineTokens("CoolPlayer Lv.85");
    expect(result.memberLevel).toBe(85);
    expect(result.extractedName).toBe("CoolPlayer");
  });

  it("extracts member level Lv N (no dot)", () => {
    const result = parseLineTokens("CoolPlayer Lv 100");
    expect(result.memberLevel).toBe(100);
  });

  it("extracts both power and level", () => {
    const result = parseLineTokens("SomeName 5.3M Lv.70");
    expect(result.heroPowerM).toBeCloseTo(5.3);
    expect(result.memberLevel).toBe(70);
    expect(result.extractedName).toBe("SomeName");
  });

  it("returns name only when no stats tokens", () => {
    const result = parseLineTokens("JustAName");
    expect(result.heroPowerM).toBeUndefined();
    expect(result.memberLevel).toBeUndefined();
    expect(result.extractedName).toBe("JustAName");
  });

  it("handles name with spaces", () => {
    const result = parseLineTokens("Big Daddy 123 8.0M");
    expect(result.heroPowerM).toBe(8.0);
    expect(result.extractedName).toBe("Big Daddy 123");
  });
});

// ---------------------------------------------------------------------------
// parseRankListRows
// ---------------------------------------------------------------------------

describe("parseRankListRows", () => {
  const lines = [
    "Search for Members",
    "R5",
    "BigLeader 8.5M Lv.95",
    "R4",
    "Warlord ShadowFox 4.2M",
    "Recruiter StarDust Lv.70",
    "R3",
    "Player1 2.1M",
    "Player2",
    "Online",
    "R1",
    "Newbie1",
  ];

  it("produces one row per member line (not headers/ignored)", () => {
    const rows = parseRankListRows(lines);
    const names = rows.map((r) => r.extractedName);
    expect(names).toContain("BigLeader");
    expect(names.some((n) => n.includes("Search"))).toBe(false);
  });

  it("assigns correct ranks from preceding headers", () => {
    const rows = parseRankListRows(lines);
    const leader = rows.find((r) => r.extractedName.includes("BigLeader"));
    expect(leader?.allianceRank).toBe(5);

    const p1 = rows.find((r) => r.extractedName.includes("Player1"));
    expect(p1?.allianceRank).toBe(3);

    const newbie = rows.find((r) => r.extractedName.includes("Newbie1"));
    expect(newbie?.allianceRank).toBe(1);
  });

  it("includes stat tokens when present", () => {
    const rows = parseRankListRows(lines);
    const leader = rows.find((r) => r.extractedName.includes("BigLeader"));
    expect(leader?.heroPowerM).toBeCloseTo(8.5);
    expect(leader?.memberLevel).toBe(95);
  });

  it("sets layout='rank_list' on all rows", () => {
    const rows = parseRankListRows(lines);
    expect(rows.every((r) => r.layout === "rank_list")).toBe(true);
  });

  it("drops lines with no rank context (before first header)", () => {
    const linesNoHeader = ["Player1 1.0M", "Player2"];
    const rows = parseRankListRows(linesNoHeader);
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// parseOfficersRows
// ---------------------------------------------------------------------------

describe("parseOfficersRows", () => {
  const lines = [
    "Leader BigDaddy 8.5M Lv.95",
    "Warlord ShadowFox 4.2M",
    "Recruiter StarDust Lv.70",
    "Muse CoolGirl",
    "Butler Servant1",
    "Online",
    "Search for Members",
  ];

  it("detects leader as R5 with title", () => {
    const rows = parseOfficersRows(lines);
    const leader = rows.find((r) => r.allianceRankTitle === "Leader");
    expect(leader).toBeDefined();
    expect(leader?.allianceRank).toBe(5);
    expect(leader?.extractedName).toContain("BigDaddy");
  });

  it("detects R4 titled officers", () => {
    const rows = parseOfficersRows(lines);
    const warlord = rows.find((r) => r.allianceRankTitle === "Warlord");
    expect(warlord?.allianceRank).toBe(4);
    expect(warlord?.heroPowerM).toBeCloseTo(4.2);

    const recruiter = rows.find((r) => r.allianceRankTitle === "Recruiter");
    expect(recruiter?.allianceRank).toBe(4);
    expect(recruiter?.memberLevel).toBe(70);
  });

  it("ignores UI chrome", () => {
    const rows = parseOfficersRows(lines);
    const names = rows.map((r) => r.extractedName);
    expect(names.some((n) => n.toLowerCase().includes("online"))).toBe(false);
    expect(names.some((n) => n.toLowerCase().includes("search"))).toBe(false);
  });

  it("sets layout='officers' on all rows", () => {
    const rows = parseOfficersRows(lines);
    expect(rows.every((r) => r.layout === "officers")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseRosterRows (unified entry point)
// ---------------------------------------------------------------------------

describe("parseRosterRows", () => {
  it("auto-detects rank_list layout", () => {
    const lines = ["R5", "Leader1", "R4", "Officer1", "R3", "Member1"];
    const { layout } = parseRosterRows(lines);
    expect(layout).toBe("rank_list");
  });

  it("auto-detects officers layout", () => {
    const lines = ["Leader BigBoss 5.0M", "Warlord ShadowFox", "Recruiter StarDust"];
    const { layout } = parseRosterRows(lines);
    expect(layout).toBe("officers");
  });

  it("respects explicit layout override", () => {
    const lines = ["Leader BigBoss", "Warlord Fox"];
    const { layout } = parseRosterRows(lines, "rank_list");
    expect(layout).toBe("rank_list");
  });

  it("returns valid rows in all cases", () => {
    const lines = ["R3", "Player1 2.5M", "Player2 Lv.60"];
    const { rows } = parseRosterRows(lines);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.allianceRank).toBeGreaterThanOrEqual(1);
      expect(row.allianceRank).toBeLessThanOrEqual(5);
    }
  });
});
