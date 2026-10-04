import { describe, expect, it } from "vitest";

import {
  batchSourceKindLabelKey,
  batchStatusLabelKey,
  boardTeamScope,
  formatEventScore,
  participationCreditFor,
  resultFilterOf,
  scoreMinimumFor,
} from "./workspace.shared";

describe("formatEventScore", () => {
  it("formats exact decimal strings with locale separators", () => {
    expect(formatEventScore("12345678901234567890", "en-US")).toBe(
      "12,345,678,901,234,567,890",
    );
  });

  it("returns null for missing scores and raw text for malformed input", () => {
    expect(formatEventScore(null, "en-US")).toBeNull();
    expect(formatEventScore("", "en-US")).toBeNull();
    expect(formatEventScore("abc", "en-US")).toBe("abc");
  });
});

describe("participationCreditFor", () => {
  it("maps poll and legacy classes to projection credits", () => {
    expect(participationCreditFor({ evidenceClass: "yes_only", participation: null })).toBe("1000");
    expect(participationCreditFor({ evidenceClass: "explicit_no", participation: null })).toBe("1");
    expect(participationCreditFor({ evidenceClass: "legacy_leaderboard", participation: null })).toBe("2000");
    expect(participationCreditFor({ evidenceClass: "real", participation: "yes" })).toBe("1000");
    expect(participationCreditFor({ evidenceClass: "real", participation: null })).toBeNull();
  });
});

describe("resultFilterOf", () => {
  it("buckets conflict before any other class", () => {
    expect(resultFilterOf({ evidenceClass: "real", participation: null, conflictKind: "real_score_mismatch" })).toBe("conflict");
    expect(resultFilterOf({ evidenceClass: "conflict", participation: null, conflictKind: null })).toBe("conflict");
  });

  it("buckets scored, yes, and no rows", () => {
    expect(resultFilterOf({ evidenceClass: "real", participation: null, conflictKind: null })).toBe("scored");
    expect(resultFilterOf({ evidenceClass: "legacy_leaderboard", participation: null, conflictKind: null })).toBe("scored");
    expect(resultFilterOf({ evidenceClass: "yes_only", participation: null, conflictKind: null })).toBe("yes_only");
    expect(resultFilterOf({ evidenceClass: "explicit_no", participation: null, conflictKind: null })).toBe("no_only");
    expect(resultFilterOf({ evidenceClass: "none", participation: null, conflictKind: null })).toBeNull();
  });
});

describe("scoreMinimumFor", () => {
  it("returns the family minimum and a default", () => {
    expect(scoreMinimumFor("warzone-duel")).toBe("1");
    expect(scoreMinimumFor("frontline-breakthrough")).toBe("0");
    expect(scoreMinimumFor(null)).toBe("0");
  });
});

describe("boardTeamScope", () => {
  it("recognizes storm team board keys", () => {
    expect(boardTeamScope("a")).toBe("A");
    expect(boardTeamScope("team-b")).toBe("B");
    expect(boardTeamScope("Team_B")).toBe("B");
    expect(boardTeamScope("main")).toBeNull();
  });
});

describe("batch label keys", () => {
  it("maps known source kinds and statuses to i18n keys", () => {
    expect(batchSourceKindLabelKey("ashed_import")).toBe("batchSourceAshedImport");
    expect(batchSourceKindLabelKey("unknown_kind")).toBe("batchSourceUnknown");
    expect(batchStatusLabelKey("committed")).toBe("batchStatusCommitted");
    expect(batchStatusLabelKey("pending")).toBe("batchStatusUnknown");
  });
});
