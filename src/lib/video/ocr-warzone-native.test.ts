import { describe, expect, it } from "vitest";

import {
  detectPollOption,
  detectWarzoneLayout,
  parseWarzoneExtractResult,
  parseWarzoneFrameLines,
  parseWarzoneLeaderboardLines,
  parseWarzonePollLines,
} from "@/lib/video/ocr-warzone-native";

const W = 1800;
const H = 2400;

type Line = { text: string; bbox?: { x0: number; y0: number; x1: number; y1: number } | null };

function line(text: string, x0: number, y0: number, x1: number, y1: number): Line {
  return { text, bbox: { x0, y0, x1, y1 } };
}

// Synthetic leaderboard geometry: RANKING + Commander/Points headers, then
// `rank | name | points` rows with a `[TAG]alliance` line under each name.
function leaderboardHeaders(): Line[] {
  return [
    line("RANKING", 760, 80, 1040, 120),
    line("Commander", 400, 200, 560, 240),
    line("Points", 1300, 200, 1420, 240),
  ];
}

function leaderboardRow(
  rank: string,
  name: string,
  points: string,
  y0: number,
  tag = "[LFgo]Live Free Die Hard",
): Line[] {
  return [
    line(rank, 100, y0, 150, y0 + 40),
    line(name, 420, y0, 700, y0 + 40),
    line(tag, 420, y0 + 45, 780, y0 + 80),
    line(points, 1300, y0, 1500, y0 + 40),
  ];
}

function pollHeader(optionDigit: string | null): Line[] {
  const lines = [line("VOTING MEMBERS", 200, 600, 560, 645)];
  if (optionDigit != null) {
    lines.push(
      line(
        `The following members chose option ${optionDigit} in this vote`,
        200,
        660,
        1100,
        700,
      ),
    );
  }
  return lines;
}

function pollRow(name: string, y0: number): Line {
  return line(`${name} Power:12,345,678 LV.35`, 200, y0, 900, y0 + 36);
}

describe("detectWarzoneLayout", () => {
  it("detects the RANKING leaderboard layout", () => {
    expect(
      detectWarzoneLayout([
        ...leaderboardHeaders(),
        ...leaderboardRow("52", "XxxTwiztedxxX", "9,620,844", 320),
      ]),
    ).toBe("leaderboard");
  });

  it("detects the VOTING MEMBERS poll layout", () => {
    expect(detectWarzoneLayout([...pollHeader("1"), pollRow("ST1tCH", 760)])).toBe(
      "poll",
    );
  });

  it("returns unknown for unrelated screenshots", () => {
    expect(
      detectWarzoneLayout([
        line("Alliance", 100, 100, 300, 140),
        line("Members online", 100, 200, 400, 240),
        line("Chat message text", 100, 300, 500, 340),
      ]),
    ).toBe("unknown");
  });
});

describe("parseWarzoneLeaderboardLines", () => {
  it("parses rank, name, points and alliance tag per row", () => {
    const lines = [
      ...leaderboardHeaders(),
      ...leaderboardRow("52", "XxxTwiztedxxX", "9,620,844", 320),
      ...leaderboardRow("53", "Sargentão Xavier", "9,606,876", 410),
      ...leaderboardRow("54", "ST1tCH", "9,574,146", 500),
    ];
    const rows = parseWarzoneLeaderboardLines(lines, W, H, "LFgo");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      name: "XxxTwiztedxxX",
      allianceTag: "LFgo",
      actualScore: "9620844",
      observedRank: 52,
    });
    expect(rows[1].name).toBe("Sargentão Xavier");
    expect(rows[2].name).toBe("ST1tCH");
  });

  it("keeps digits inside names and literal 1,000/2,000 real scores", () => {
    const rows = parseWarzoneLeaderboardLines(
      [
        ...leaderboardHeaders(),
        ...leaderboardRow("65", "DENIZ 1", "8,663,947", 320),
        ...leaderboardRow("87", "Bat Pig", "1,000", 410),
        ...leaderboardRow("88", "Sky Shark", "2,000", 500),
      ],
      W,
      H,
      "LFgo",
    );
    expect(rows.map((row) => row.name)).toEqual([
      "DENIZ 1",
      "Bat Pig",
      "Sky Shark",
    ]);
    expect(rows[1].actualScore).toBe("1000");
    expect(rows[2].actualScore).toBe("2000");
  });

  it("drops rows carrying a foreign alliance tag", () => {
    const rows = parseWarzoneLeaderboardLines(
      [
        ...leaderboardHeaders(),
        ...leaderboardRow("52", "ST1tCH", "9,574,146", 320),
        ...leaderboardRow("53", "TwinName", "9,500,000", 410, "[XYZw]Other Alliance"),
      ],
      W,
      H,
      "LFgo",
    );
    expect(rows.map((row) => row.name)).toEqual(["ST1tCH"]);
  });

  it("keeps tag-less rows when the tag line is unreadable", () => {
    const lines = [
      ...leaderboardHeaders(),
      line("47", 100, 320, 150, 360),
      line("PartialName", 420, 320, 700, 360),
      line("9,700,000", 1300, 320, 1500, 360),
    ];
    const rows = parseWarzoneLeaderboardLines(lines, W, H, "LFgo");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "PartialName", allianceTag: null });
  });

  it("never turns a Power/LV annotation into a leaderboard score", () => {
    const lines = [
      ...leaderboardHeaders(),
      line("52", 100, 320, 150, 360),
      line("PowerName", 420, 320, 700, 360),
      line("[LFgo]Live Free Die Hard", 420, 365, 780, 400),
      line("Power:1,234 LV.35", 1300, 320, 1600, 360),
    ];
    const rows = parseWarzoneLeaderboardLines(lines, W, H, "LFgo");
    expect(rows).toHaveLength(1);
    expect(rows[0].actualScore).toBeNull();
  });

  it("dedupes the green pinned self row against its in-list copy", () => {
    const rows = parseWarzoneLeaderboardLines(
      [
        ...leaderboardHeaders(),
        ...leaderboardRow("91", "BLAKE2Bogs", "7,478,091", 320),
        // Pinned duplicate near the bottom (yCenter > 80% height).
        ...leaderboardRow("91", "BLAKE2Bogs", "7,478,091", 2000),
      ],
      W,
      H,
      "LFgo",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("BLAKE2Bogs");
  });
});

describe("parseWarzonePollLines", () => {
  it("parses option 1 rows", () => {
    const { option, entries } = parseWarzonePollLines(
      [
        ...pollHeader("1"),
        pollRow("ST1tCH", 760),
        pollRow("R4 Richiè", 860),
        pollRow("CRAZYNHO", 960),
        // Background chat without the Power anchor is not a row.
        line("[LFgo]Sargentão Xavier", 200, 1100, 700, 1140),
        line("TEAM CRAZY", 200, 1160, 500, 1200),
      ],
      W,
      H,
    );
    expect(option).toBe(1);
    expect(entries.map((entry) => entry.name)).toEqual([
      "ST1tCH",
      "Richiè",
      "CRAZYNHO",
    ]);
  });

  it("parses option 2 rows", () => {
    const { option, entries } = parseWarzonePollLines(
      [...pollHeader("2"), pollRow("Clamanthà", 760)],
      W,
      H,
    );
    expect(option).toBe(2);
    expect(entries[0].name).toBe("Clamanthà");
  });

  it("returns a null option when the header is unreadable", () => {
    const { option, entries } = parseWarzonePollLines(
      [...pollHeader(null), pollRow("ST1tCH", 760)],
      W,
      H,
    );
    expect(option).toBeNull();
    expect(entries).toHaveLength(1);
  });

  it("requires the Power anchor so name-only dialog lines are ignored", () => {
    const { entries } = parseWarzonePollLines(
      [...pollHeader("1"), line("JustAName LV.35", 200, 760, 700, 800)],
      W,
      H,
    );
    expect(entries).toHaveLength(0);
  });
});

describe("detectPollOption", () => {
  it("reads the option digit from the header line", () => {
    expect(detectPollOption(pollHeader("1"))).toBe(1);
    expect(detectPollOption(pollHeader("2"))).toBe(2);
  });
});

describe("parseWarzoneFrameLines", () => {
  it("marks a manual format override contradiction", () => {
    const result = parseWarzoneFrameLines(
      [...pollHeader("1"), pollRow("ST1tCH", 760)],
      W,
      H,
      { format: "leaderboard" },
    );
    expect(result.frame.kind).toBe("poll");
    expect(result.formatMismatch).toBe(true);
  });

  it("produces a foreground safeCrop around headers and rows", () => {
    const result = parseWarzoneFrameLines(
      [
        ...leaderboardHeaders(),
        ...leaderboardRow("52", "XxxTwiztedxxX", "9,620,844", 320),
      ],
      W,
      H,
    );
    expect(result.frame.kind).toBe("leaderboard");
    expect(result.safeCrop).not.toBeNull();
    expect(result.safeCrop!.top).toBeGreaterThan(0);
    expect(result.safeCrop!.height).toBeLessThan(1);
  });

  it("returns unknown with a reason for unrecognized frames", () => {
    const result = parseWarzoneFrameLines(
      [line("unrelated text", 100, 100, 400, 140)],
      W,
      H,
    );
    expect(result.frame).toEqual({ kind: "unknown", reason: "layout_not_detected" });
    expect(result.safeCrop).toBeNull();
  });
});

describe("parseWarzoneExtractResult (Ashed provider contract)", () => {
  it("maps a leaderboard payload onto the frame contract", () => {
    const frame = parseWarzoneExtractResult({
      layout: "leaderboard",
      entries: [
        { name: "ST1tCH", score: "9574146", observedRank: 54, allianceTag: "LFgo" },
      ],
    });
    expect(frame.kind).toBe("leaderboard");
    if (frame.kind === "leaderboard") {
      expect(frame.entries[0].actualScore).toBe("9574146");
      expect(frame.entries[0].observedRank).toBe(54);
    }
  });

  it("maps a poll payload and keeps a missing option unresolved", () => {
    const frame = parseWarzoneExtractResult({
      layout: "poll",
      entries: [{ name: "ST1tCH" }],
    });
    expect(frame).toEqual({
      kind: "poll",
      option: null,
      entries: [{ name: "ST1tCH", crop: null }],
    });
  });

  it("degrades malformed payloads to unknown", () => {
    expect(parseWarzoneExtractResult(null)).toEqual({
      kind: "unknown",
      reason: "empty_extract",
    });
    expect(parseWarzoneExtractResult({ layout: "nonsense" })).toEqual({
      kind: "unknown",
      reason: "unrecognized_layout",
    });
  });
});
