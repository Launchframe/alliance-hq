import { describe, expect, it } from "vitest";

import {
  collapseEntriesBySanitizedName,
  dedupeEntries,
  extractEntries,
  mergeOcrResults,
  normalizeName,
  normalizeScoreValue,
  parseScoreNumber,
  sanitizedNameKey,
  stripParsedNameDecorations,
  unwrapOcrPayload,
} from "@/lib/video/normalize-rows";

describe("normalizeName", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeName("  Freddy  ")).toBe("Freddy");
    expect(normalizeName("a   b")).toBe("a b");
  });
});

describe("stripParsedNameDecorations", () => {
  it("removes bracketed alliance tags", () => {
    expect(stripParsedNameDecorations("[LFgo]Freddy")).toBe("Freddy");
    expect(stripParsedNameDecorations("[LFgo] Bat Pig")).toBe("Bat Pig");
  });

  it("removes bare alliance tag prefix", () => {
    expect(stripParsedNameDecorations("LFgo Freddy", "LFgo")).toBe("Freddy");
    expect(stripParsedNameDecorations("LFgoFreddy", "LFgo")).toBe("Freddy");
    expect(stripParsedNameDecorations("lfgo Freddy", "LFgo")).toBe("Freddy");
  });

  it("leaves names unchanged when no tag applies", () => {
    expect(stripParsedNameDecorations("Freddy")).toBe("Freddy");
  });
});

describe("sanitizedNameKey", () => {
  it("lowercases stripped names", () => {
    expect(sanitizedNameKey("[LFgo]Freddy", "LFgo")).toBe("freddy");
  });
});

describe("normalizeScoreValue", () => {
  it("strips commas from string scores", () => {
    expect(normalizeScoreValue("4,858,994")).toBe("4858994");
  });

  it("stringifies non-integer numbers", () => {
    expect(normalizeScoreValue(1.5)).toBe("1.5");
  });
});

describe("parseScoreNumber", () => {
  it("parses cleaned scores", () => {
    expect(parseScoreNumber("4,858,994")).toBe(4858994);
  });

  it("throws on invalid scores", () => {
    expect(() => parseScoreNumber("nope")).toThrow("Invalid score");
  });
});

describe("unwrapOcrPayload", () => {
  it("unwraps nested output and data", () => {
    expect(unwrapOcrPayload({ output: { entries: [] } })).toEqual({
      entries: [],
    });
    expect(unwrapOcrPayload({ data: { entries: [] } })).toEqual({
      entries: [],
    });
    expect(unwrapOcrPayload({ entries: [] })).toEqual({ entries: [] });
  });

  it("returns null for invalid payloads", () => {
    expect(unwrapOcrPayload(null)).toBeNull();
    expect(unwrapOcrPayload("bad")).toBeNull();
  });
});

describe("extractEntries", () => {
  it("maps OCR payload to entries", () => {
    expect(
      extractEntries({
        output: {
          entries: [
            { name: "  Freddy ", score: 100 },
            { name: "", score: 1 },
          ],
        },
      }),
    ).toEqual([{ name: "Freddy", score: "100" }]);
  });

  it("returns empty for invalid payloads", () => {
    expect(extractEntries(null)).toEqual([]);
    expect(extractEntries({ entries: "bad" })).toEqual([]);
  });
});

describe("dedupeEntries", () => {
  it("dedupes by name and score", () => {
    const entries = dedupeEntries([
      { name: "Freddy", score: "1" },
      { name: "Freddy", score: "1" },
      { name: "Freddy", score: "2" },
    ]);
    expect(entries).toHaveLength(2);
  });
});

describe("mergeOcrResults", () => {
  it("flattens and dedupes batches", () => {
    const merged = mergeOcrResults([
      [{ name: "A", score: "1" }],
      [{ name: "A", score: "1" }, { name: "B", score: "2" }],
    ]);
    expect(merged).toHaveLength(2);
  });

  it("threads _sourceFrameIndex through mergeOcrResults and preserves first-seen frame", () => {
    const merged = mergeOcrResults([
      [{ name: "Alice", score: "100", _sourceFrameIndex: 2 }],
      [{ name: "Alice", score: "100", _sourceFrameIndex: 5 }],
      [{ name: "Bob", score: "200", _sourceFrameIndex: 3 }],
    ]);
    const alice = merged.find((e) => e.name === "Alice");
    const bob = merged.find((e) => e.name === "Bob");
    expect(alice?._sourceFrameIndex).toBe(2);
    expect(bob?._sourceFrameIndex).toBe(3);
  });
});

describe("collapseEntriesBySanitizedName", () => {
  it("collapses tag variants with plurality score winner", () => {
    const { entries, unresolvedConflicts } = collapseEntriesBySanitizedName(
      [
        { name: "Freddy", score: "4858994" },
        { name: "Freddy", score: "4848800" },
        { name: "[LFgo]Freddy", score: "4858994" },
      ],
      "LFgo",
    );

    expect(unresolvedConflicts).toEqual([]);
    expect(entries).toEqual([{ name: "Freddy", score: "4858994" }]);
  });

  it("keeps conflicting scores when tied", () => {
    const { entries, unresolvedConflicts } = collapseEntriesBySanitizedName(
      [
        { name: "Freddy", score: "100" },
        { name: "[LFgo]Freddy", score: "200" },
      ],
      "LFgo",
    );

    expect(unresolvedConflicts).toEqual(["freddy"]);
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.scoreConflict)).toBe(true);
  });

  it("prefers cleaner display names within the same sanitized group", () => {
    const { entries } = collapseEntriesBySanitizedName(
      [
        { name: "[LFgo]Freddy", score: "100" },
        { name: "Freddy", score: "100" },
      ],
      "LFgo",
    );
    expect(entries).toEqual([{ name: "Freddy", score: "100" }]);
  });

  it("skips entries whose sanitized name is empty", () => {
    const { entries } = collapseEntriesBySanitizedName(
      [{ name: "[LFgo]", score: "100" }],
      "LFgo",
    );
    expect(entries).toEqual([]);
  });

  it("collapses lossy decimal score with full integer for same player", () => {
    const { entries, unresolvedConflicts } = collapseEntriesBySanitizedName([
      { name: "Bat Pig", score: "46.69" },
      { name: "Bat Pig", score: "46690000000" },
    ]);

    expect(unresolvedConflicts).toEqual([]);
    expect(entries).toEqual([{ name: "Bat Pig", score: "46690000000" }]);
  });

  it("prefers full integer over lossy decimal even when decimal has plurality", () => {
    const { entries, unresolvedConflicts } = collapseEntriesBySanitizedName([
      { name: "Bat Pig", score: "46.69" },
      { name: "Bat Pig", score: "46.69" },
      { name: "Bat Pig", score: "46690000000" },
    ]);

    expect(unresolvedConflicts).toEqual([]);
    expect(entries).toEqual([{ name: "Bat Pig", score: "46690000000" }]);
  });

  it("still uses plurality when all scores are integers", () => {
    const { entries, unresolvedConflicts } = collapseEntriesBySanitizedName([
      { name: "Redd", score: "4858994" },
      { name: "Redd", score: "4858994" },
      { name: "Redd", score: "4848800" },
    ]);

    expect(unresolvedConflicts).toEqual([]);
    expect(entries).toEqual([{ name: "Redd", score: "4858994" }]);
  });

  it("does not collapse tied integer scores just because one has more digits", () => {
    const { entries, unresolvedConflicts } = collapseEntriesBySanitizedName([
      { name: "Redd", score: "4858994" },
      { name: "Redd", score: "485899" },
    ]);

    expect(unresolvedConflicts).toEqual(["redd"]);
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.scoreConflict)).toBe(true);
  });
});
