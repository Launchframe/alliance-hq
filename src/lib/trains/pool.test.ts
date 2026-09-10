import { describe, expect, it } from "vitest";

import {
  activePoolGenerationForDate,
  poolGenerationsToClaim,
  poolTypeUsesSequence,
} from "@/lib/trains/pool";

describe("activePoolGenerationForDate", () => {
  it("returns generation 1 when no rows exist", () => {
    expect(activePoolGenerationForDate([], [], "2026-06-15")).toBe(1);
  });

  it("returns first generation with an open slot before date", () => {
    const entries = [
      { generation: 1, selectedForDate: "2026-06-10" },
      { generation: 1, selectedForDate: "2026-06-12" },
      { generation: 2, selectedForDate: null },
    ];
    expect(
      activePoolGenerationForDate([1, 2], entries, "2026-06-15"),
    ).toBe(2);
  });

  it("returns generation active on a historical date before exhaustion", () => {
    const entries = [
      { generation: 1, selectedForDate: "2026-06-10" },
      { generation: 1, selectedForDate: null },
      { generation: 2, selectedForDate: null },
    ];
    expect(
      activePoolGenerationForDate([1, 2], entries, "2026-06-11"),
    ).toBe(1);
  });

  it("falls through to latest generation when all prior gens exhausted", () => {
    const entries = [
      { generation: 1, selectedForDate: "2026-06-08" },
      { generation: 1, selectedForDate: "2026-06-09" },
      { generation: 2, selectedForDate: "2026-06-10" },
      { generation: 2, selectedForDate: null },
    ];
    expect(
      activePoolGenerationForDate([1, 2], entries, "2026-06-15"),
    ).toBe(2);
  });
});

describe("poolGenerationsToClaim", () => {
  it("claims only the current generation for today", () => {
    expect(
      poolGenerationsToClaim({
        currentGeneration: 2,
        historicalGeneration: 1,
        useHistorical: false,
      }),
    ).toEqual([2]);
  });

  it("tries current generation before a stale historical generation", () => {
    expect(
      poolGenerationsToClaim({
        currentGeneration: 2,
        historicalGeneration: 1,
        useHistorical: true,
      }),
    ).toEqual([2, 1]);
  });
});

describe("poolTypeUsesSequence", () => {
  it("only treats r4_plus as sequence pools", () => {
    expect(poolTypeUsesSequence("r4_plus")).toBe(true);
    expect(poolTypeUsesSequence("r3")).toBe(false);
    expect(poolTypeUsesSequence("all_members")).toBe(false);
    expect(poolTypeUsesSequence("event_top_x")).toBe(false);
    expect(poolTypeUsesSequence("heavy_hitter")).toBe(false);
  });
});
