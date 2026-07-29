import { describe, expect, it } from "vitest";

import {
  cleanMemberName,
  parseLineTokens,
  parseOfficersRows,
  parseRankListRows,
  parseRosterRows,
} from "@/lib/members/roster-ocr/parse-rows";

// ---------------------------------------------------------------------------
// parseLineTokens / cleanMemberName
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

  it("does not mistake a last-seen timestamp for hero power (Xm ago)", () => {
    // Regression: POWER_RE is case-insensitive, so "1m ago" was matched as
    // "1M" power, leaving a dangling "ago" behind in the name once the
    // digit+unit it depended on was stripped away.
    const result = parseLineTokens("capt Atano 1m ago");
    expect(result.heroPowerM).toBeUndefined();
    expect(result.extractedName).toBe("capt Atano");
  });

  it("strips timestamps of various units without fabricating power", () => {
    expect(parseLineTokens("ARC YDNA 14m ago").heroPowerM).toBeUndefined();
    expect(parseLineTokens("ARC YDNA 14m ago").extractedName).toBe("ARC YDNA");
    expect(parseLineTokens("BroHawk 1h ago").extractedName).toBe("BroHawk");
    expect(parseLineTokens("Boozwell 38m ago").heroPowerM).toBeUndefined();
  });

  it("still extracts a real power reading alongside a timestamp elsewhere", () => {
    const result = parseLineTokens("SomeName 5.3M 14m ago");
    expect(result.heroPowerM).toBeCloseTo(5.3);
    expect(result.extractedName).toBe("SomeName");
  });

  it("tolerates OCR misreading the power decimal point as an apostrophe or quote", () => {
    expect(parseLineTokens("Gitolitosito Power:}160'0M").heroPowerM).toBeCloseTo(
      160.0,
    );
    expect(
      parseLineTokens('usagi Power:}148"4M').heroPowerM,
    ).toBeCloseTo(148.4);
    expect(parseLineTokens("SomeName 69'8M").heroPowerM).toBeCloseTo(69.8);
  });

  it("falls back to a bare L for member level when Power is on the same line", () => {
    // OCR sometimes drops the "v" in "Lv" entirely. Real capture: the stats
    // line is separate from the name line and merged in via isStatsOnlyLine.
    const result = parseLineTokens("(as! Power]69'8M L126!");
    expect(result.heroPowerM).toBeCloseTo(69.8);
    expect(result.memberLevel).toBe(126);
  });

  it("does not treat a bare L in a name as level without Power context", () => {
    const result = parseLineTokens("L33tHaxor");
    expect(result.memberLevel).toBeUndefined();
    expect(result.extractedName).toBe("L33tHaxor");
  });

  it("strips R5 badge prefixes and last-online suffixes", () => {
    expect(cleanMemberName("R5| Corn Goo Smeller").name).toBe(
      "Corn Goo Smeller",
    );
    expect(cleanMemberName("R5| Corn Goo Smeller").rankHint).toBe(5);
    expect(cleanMemberName("Nobell 1h ago").name).toBe("Nobell");
    expect(cleanMemberName("@ Nobell 61 ago").name).toBe("Nobell");
  });

  it("strips gender-icon OCR glue before usernames", () => {
    expect(cleanMemberName("♂CoolPlayer Online").name).toBe("CoolPlayer");
    expect(cleanMemberName("♀ ShadowFox 41m ago").name).toBe("ShadowFox");
    expect(cleanMemberName("| urmom90 Online |").name).toBe("urmom90");
  });

  it("parses Power: labeled stats lines", () => {
    const result = parseLineTokens("Power: 94.1M Lv.26");
    expect(result.heroPowerM).toBeCloseTo(94.1);
    expect(result.memberLevel).toBe(26);
    expect(result.extractedName).toBe("");
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

  it("strips officer titles from list names and never sets title", () => {
    const rows = parseRankListRows(lines);
    const fox = rows.find((r) => r.extractedName.includes("ShadowFox"));
    expect(fox?.extractedName).toBe("ShadowFox");
    expect(fox?.allianceRankTitle).toBeUndefined();
    expect(fox?.allianceRank).toBe(4);
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

  it("parses a member name with an inline last-seen timestamp without bogus power", () => {
    const rows = parseRankListRows([
      "Search for Members",
      "R3 9/78",
      "capt Atano 1m ago",
      "Power: 69.8M Lv.126",
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.extractedName).toBe("capt Atano");
    expect(rows[0]?.allianceRank).toBe(3);
    expect(rows[0]?.heroPowerM).toBeCloseTo(69.8);
    expect(rows[0]?.memberLevel).toBe(126);
  });

  it("excludes header chrome and merges Power/Lv onto the prior name", () => {
    const membersPage = [
      "R5| Corn Goo Smeller",
      "Warlord",
      "Recruiter Muse Butler",
      "Cmoney1985 urmom90 RodDadBod Lumplicious",
      "Search for Members",
      "R4 0/10",
      "R3 9/78",
      "C Price",
      "Power: 94.1M Lv.26",
      "Online",
      "Manage",
      "Nobell 1h ago",
      "Power: 112.0M Lv.30",
    ];
    const rows = parseRankListRows(membersPage);
    const names = rows.map((r) => r.extractedName);

    expect(names.some((n) => /recruiter|muse|butler|warlord/i.test(n))).toBe(
      false,
    );
    expect(names.some((n) => /Corn Goo/i.test(n))).toBe(false);

    const price = rows.find((r) => r.extractedName === "C Price");
    expect(price?.allianceRank).toBe(3);
    expect(price?.heroPowerM).toBeCloseTo(94.1);
    expect(price?.memberLevel).toBe(26);

    const nobell = rows.find((r) => r.extractedName === "Nobell");
    expect(nobell?.allianceRank).toBe(3);
    expect(nobell?.heroPowerM).toBeCloseTo(112);
    expect(nobell?.memberLevel).toBe(30);
  });

  it("uses quota-bearing rank headers", () => {
    const rows = parseRankListRows([
      "R4 0/10",
      "R3 9/78",
      "ForkingELITE 203.6M Lv.32",
    ]);
    expect(rows[0]?.allianceRank).toBe(3);
    expect(rows[0]?.extractedName).toBe("ForkingELITE");
  });

  it("does not emit custom rank group titles as member rows", () => {
    const rows = parseRankListRows([
      "Search for Members",
      "R3",
      "Heart of the Alliance 7/83",
      "C Price",
      "Power: 94.1M Lv.26",
    ]);
    const names = rows.map((r) => r.extractedName);
    expect(names).not.toContain("Heart of the Alliance");
    expect(names).toContain("C Price");

    const price = rows.find((r) => r.extractedName === "C Price");
    expect(price?.allianceRank).toBe(3);
    expect(price?.heroPowerM).toBeCloseTo(94.1);
    expect(price?.memberLevel).toBe(26);
  });

  it("uses sticky rank when header scrolled off frame", () => {
    const rows = parseRankListRows(
      ["C Price", "Power: 94.1M Lv.26"],
      { stickyRank: 3 },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.extractedName).toBe("C Price");
    expect(rows[0]?.allianceRank).toBe(3);
    expect(rows[0]?.heroPowerM).toBeCloseTo(94.1);
  });

  it("handles OCR-split rank group header before members", () => {
    const rows = parseRankListRows([
      "R3 7/83",
      "Heart of the Alliance (v",
      "C Price",
      "Power: 94.1M Lv.26",
    ]);
    const names = rows.map((r) => r.extractedName);
    expect(names.some((n) => /heart of the alliance/i.test(n))).toBe(false);
    expect(names).toContain("C Price");
  });

  // -------------------------------------------------------------------------
  // Real-world regression: job _PUUrjOcByVE3qSc (post-#456). Header renders
  // as ONE combined line with no quota digits ever captured by OCR.
  // -------------------------------------------------------------------------

  it("does not leak a same-line combined header (no quota) as a member row", () => {
    const rows = parseRankListRows([
      "Search for Members",
      "R3 Heart of the Alliance (wv |",
      "C Price",
      "Power: 94.1M Lv.26",
    ]);
    const names = rows.map((r) => r.extractedName);
    expect(names.some((n) => /heart of the alliance/i.test(n))).toBe(false);
    expect(names).toContain("C Price");

    const price = rows.find((r) => r.extractedName === "C Price");
    expect(price?.allianceRank).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Real-world regression: job dtSB32xtMr39bpHH frame 3 (post-#456). Header
  // "R3) on M" was previously unrecognized, leaked as a fake member, and
  // starved rank context for every real member later in the frame.
  // -------------------------------------------------------------------------

  it("replays job dtSB32xtMr39bpHH frame 3 raw OCR: header sets context, no leak", () => {
    const frame3Lines = [
      "9",
      "bang]",
      "RS) Corn Goo Smeller",
      "Warlord Recruiter, Muse Butler",
      "Cmoney1985 urmom90 RodDadBod Lumplicious",
      "Q, Search for Members",
      "R3) on M",
      "Costaeluz Online",
      "Bradock2025 Online |",
      "@ Blackie Nut Online",
    ];
    const rows = parseRankListRows(frame3Lines);
    const names = rows.map((r) => r.extractedName);

    expect(names).not.toContain("on M");
    expect(names.some((n) => /corn goo/i.test(n))).toBe(false);

    expect(names).toContain("Costaeluz");
    expect(names).toContain("Bradock2025");
    expect(names).toContain("Blackie Nut");

    for (const name of ["Costaeluz", "Bradock2025", "Blackie Nut"]) {
      const row = rows.find((r) => r.extractedName === name);
      expect(row?.allianceRank).toBe(3);
    }
  });

  it("tolerates leading OCR bracket noise on the header without dropping real members", () => {
    const rows = parseRankListRows([
      "Search for Members",
      "[R4 Crowd Control 14/10 (|",
      "urmom90",
    ]);
    const names = rows.map((r) => r.extractedName);
    expect(names.some((n) => /crowd control/i.test(n))).toBe(false);
    expect(names).toContain("urmom90");
    expect(rows.find((r) => r.extractedName === "urmom90")?.allianceRank).toBe(
      4,
    );
  });

  // Maintainer screenshot pattern: quota-bearing combined header + icon-glued name
  // + white-outlined Power/Lv on the next line.
  it("parses R4 Crowd Control header with icon-glued name and split stats", () => {
    const rows = parseRankListRows([
      "Search for Members",
      "R4 Crowd Control 4/10",
      "| urmom90 Online",
      "Power: 210.4M Lv.34",
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.extractedName).toBe("urmom90");
    expect(rows[0]?.allianceRank).toBe(4);
    expect(rows[0]?.heroPowerM).toBeCloseTo(210.4);
    expect(rows[0]?.memberLevel).toBe(34);
  });

  // Maintainer screenshot pattern: R3 Heart of the Alliance with quota on same line.
  it("parses R3 Heart of the Alliance quota header from maintainer screenshots", () => {
    const rows = parseRankListRows([
      "Search for Members",
      "R3 Heart of the Alliance 8/83",
      "C Price",
      "Power: 94.1M Lv.26",
    ]);
    expect(rows.map((r) => r.extractedName)).not.toContain("Heart of the Alliance");
    const price = rows.find((r) => r.extractedName === "C Price");
    expect(price?.allianceRank).toBe(3);
    expect(price?.heroPowerM).toBeCloseTo(94.1);
    expect(price?.memberLevel).toBe(26);
  });

  // -------------------------------------------------------------------------
  // Real Steel pass 2 (Sonnet) regression: a same-rank badge-prefixed member
  // row (e.g. "R5|BigLeader") was misclassified as a brand-new section header
  // by LOOSE_RANK_BADGE_LINE_RE whenever the member's own Power/Lv landed on
  // a separate line — silently dropping the member entirely.
  // -------------------------------------------------------------------------

  it("recovers a same-rank badge-prefixed member row instead of treating it as a duplicate header", () => {
    const rows = parseRankListRows([
      "Search for Members",
      "R5",
      "R5|BigLeader",
      "8.5M Lv.95",
    ]);
    const names = rows.map((r) => r.extractedName);
    expect(names).toContain("BigLeader");
    const leader = rows.find((r) => r.extractedName === "BigLeader");
    expect(leader?.allianceRank).toBe(5);
    expect(leader?.heroPowerM).toBeCloseTo(8.5);
    expect(leader?.memberLevel).toBe(95);
  });

  it("recovers a badge-prefixed member as the first line of a scrolled frame via stickyRank", () => {
    // No "Search for Members" and no header in view — header scrolled
    // off-screen, so context must come entirely from the prior frame's sticky
    // rank. Without it, "R3|Ace Ventura" would be ambiguous with a new header.
    const rows = parseRankListRows(
      ["R3|Ace Ventura", "Power: 40.1M Lv.50"],
      { stickyRank: 3 },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.extractedName).toBe("Ace Ventura");
    expect(rows[0]?.allianceRank).toBe(3);
    expect(rows[0]?.heroPowerM).toBeCloseTo(40.1);
  });

  it("still detects a genuine new-section header even when a differently-ranked section is already established", () => {
    const rows = parseRankListRows([
      "Search for Members",
      "R4",
      "Officer1 4.2M",
      "R3 Heart of the Alliance (wv |",
      "C Price",
      "Power: 94.1M Lv.26",
    ]);
    const names = rows.map((r) => r.extractedName);
    expect(names).not.toContain("Heart of the Alliance");
    expect(names).toContain("Officer1");
    expect(names).toContain("C Price");
    expect(rows.find((r) => r.extractedName === "C Price")?.allianceRank).toBe(
      3,
    );
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

  it("skips title-only chrome with no commander name", () => {
    const rows = parseOfficersRows(["Recruiter Muse Butler", "Warlord"]);
    expect(rows).toHaveLength(0);
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
    const lines = [
      "Leader BigBoss 5.0M",
      "Warlord ShadowFox",
      "Recruiter StarDust",
    ];
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

  it("forces rank_list after Search crop", () => {
    const { layout, rows } = parseRosterRows(
      [
        "Warlord ShadowFox",
        "Search for Members",
        "R3 9/78",
        "Player1 2.5M",
      ],
      undefined,
      { forceRankList: true },
    );
    expect(layout).toBe("rank_list");
    expect(rows.every((r) => r.allianceRank === 3)).toBe(true);
  });
});
