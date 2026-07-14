import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/video/vs-fixture-library.server", () => ({
  loadVsFixtureById: vi.fn(),
}));

import { loadFixtureAsOcrEntries } from "@/lib/video/vs-fixture-ocr-inject.server";
import { loadVsFixtureById } from "@/lib/video/vs-fixture-library.server";
import type { VsScoreDayTemplate, VsScoreWeekTemplate } from "@/lib/video/vs-fixture-types";

const mockLoadById = vi.mocked(loadVsFixtureById);

describe("loadFixtureAsOcrEntries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when fixture not found", async () => {
    mockLoadById.mockResolvedValue(null);
    const result = await loadFixtureAsOcrEntries("missing", null);
    expect(result).toBeNull();
  });

  it("converts day template rows to OcrEntry[]", async () => {
    const day: VsScoreDayTemplate = {
      id: "test-day",
      name: "Test Day",
      tags: [],
      kind: "day",
      sourceRecordedDate: "2026-07-12",
      scrapedAt: "2026-07-13T00:00:00.000Z",
      rows: [
        { name: "Alpha", score: 1000000, rank: 1 },
        { name: "Bravo", score: 900000, rank: 2 },
      ],
    };
    mockLoadById.mockResolvedValue(day);

    const result = await loadFixtureAsOcrEntries("test-day", null);
    expect(result).toHaveLength(2);
    expect(result![0]).toEqual({
      name: "Alpha",
      score: "1000000",
      rank: 1,
      _sourceFrameIndex: 0,
    });
    expect(result![1]).toEqual({
      name: "Bravo",
      score: "900000",
      rank: 2,
      _sourceFrameIndex: 0,
    });
  });

  it("selects the correct day from a week template", async () => {
    const week: VsScoreWeekTemplate = {
      id: "test-week",
      name: "Test Week",
      tags: [],
      kind: "week",
      sourceWeekStart: "2026-07-06",
      scrapedAt: "2026-07-13T00:00:00.000Z",
      days: [
        {
          sourceRecordedDate: "2026-07-06",
          rows: [{ name: "Mon Player", score: 100, rank: 1 }],
        },
        {
          sourceRecordedDate: "2026-07-07",
          rows: [{ name: "Tue Player", score: 200, rank: 1 }],
        },
      ],
    };
    mockLoadById.mockResolvedValue(week);

    const result = await loadFixtureAsOcrEntries("test-week", 1);
    expect(result).toHaveLength(1);
    expect(result![0]!.name).toBe("Tue Player");
    expect(result![0]!.score).toBe("200");
  });

  it("defaults to day 0 when fixtureDayIndex is null for week templates", async () => {
    const week: VsScoreWeekTemplate = {
      id: "test-week",
      name: "Test Week",
      tags: [],
      kind: "week",
      sourceWeekStart: "2026-07-06",
      scrapedAt: "2026-07-13T00:00:00.000Z",
      days: [
        {
          sourceRecordedDate: "2026-07-06",
          rows: [{ name: "Mon Player", score: 100, rank: 1 }],
        },
      ],
    };
    mockLoadById.mockResolvedValue(week);

    const result = await loadFixtureAsOcrEntries("test-week", null);
    expect(result).toHaveLength(1);
    expect(result![0]!.name).toBe("Mon Player");
  });

  it("assigns sequential ranks when missing from fixture rows", async () => {
    const day: VsScoreDayTemplate = {
      id: "no-ranks",
      name: "No Ranks",
      tags: [],
      kind: "day",
      sourceRecordedDate: "2026-07-12",
      scrapedAt: "2026-07-13T00:00:00.000Z",
      rows: [
        { name: "A", score: 300 },
        { name: "B", score: 200 },
      ],
    };
    mockLoadById.mockResolvedValue(day);

    const result = await loadFixtureAsOcrEntries("no-ranks", null);
    expect(result![0]!.rank).toBe(1);
    expect(result![1]!.rank).toBe(2);
  });
});
