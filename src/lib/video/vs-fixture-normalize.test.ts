import { describe, it, expect } from "vitest";
import {
  normalizeAshedVsRow,
  normalizeAshedVsRows,
} from "@/lib/video/vs-fixture-normalize";

describe("normalizeAshedVsRow", () => {
  it("extracts name, score, rank, and memberId from snake_case fields", () => {
    const row = {
      member_id: "abc123",
      member_name: "CommanderAlpha",
      score: 500000,
      rank: 3,
    };
    expect(normalizeAshedVsRow(row)).toEqual({
      name: "CommanderAlpha",
      score: 500000,
      rank: 3,
      memberId: "abc123",
    });
  });

  it("falls back to camelCase fields", () => {
    const row = {
      memberId: "xyz789",
      memberName: "BravoPlayer",
      points: 300000,
    };
    expect(normalizeAshedVsRow(row)).toEqual({
      name: "BravoPlayer",
      score: 300000,
      rank: undefined,
      memberId: "xyz789",
    });
  });

  it("uses current_name as fallback", () => {
    const row = {
      id: "id99",
      current_name: "CharlieGamer",
      total: 100000,
    };
    expect(normalizeAshedVsRow(row)).toEqual({
      name: "CharlieGamer",
      score: 100000,
      rank: undefined,
      memberId: "id99",
    });
  });

  it("returns null when no name is available", () => {
    expect(normalizeAshedVsRow({ score: 100 })).toBeNull();
  });

  it("defaults score to 0 when no score field is present", () => {
    const row = { member_name: "NoScore" };
    expect(normalizeAshedVsRow(row)?.score).toBe(0);
  });
});

describe("normalizeAshedVsRows", () => {
  it("sorts by score descending and assigns missing ranks", () => {
    const rows = [
      { member_name: "Low", score: 100 },
      { member_name: "High", score: 1000 },
      { member_name: "Mid", score: 500 },
    ];
    const result = normalizeAshedVsRows(rows);
    expect(result).toHaveLength(3);
    expect(result[0]!.name).toBe("High");
    expect(result[0]!.rank).toBe(1);
    expect(result[1]!.name).toBe("Mid");
    expect(result[1]!.rank).toBe(2);
    expect(result[2]!.name).toBe("Low");
    expect(result[2]!.rank).toBe(3);
  });

  it("preserves existing ranks", () => {
    const rows = [
      { member_name: "First", score: 1000, rank: 10 },
      { member_name: "Second", score: 500, rank: 20 },
    ];
    const result = normalizeAshedVsRows(rows);
    expect(result[0]!.rank).toBe(10);
    expect(result[1]!.rank).toBe(20);
  });

  it("filters out rows with no name", () => {
    const rows = [
      { member_name: "Valid", score: 1000 },
      { score: 500 },
      { member_name: "Also Valid", score: 200 },
    ];
    const result = normalizeAshedVsRows(rows);
    expect(result).toHaveLength(2);
  });
});
