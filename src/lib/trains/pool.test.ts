import { describe, expect, it } from "vitest";

import {
  activePoolGenerationForDate,
  poolGenerationsToClaim,
  poolTypeUsesSequence,
  resolveLockPoolClaim,
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

  it("tries the live generation first, then the date generation", () => {
    expect(
      poolGenerationsToClaim({
        currentGeneration: 2,
        historicalGeneration: 1,
        useHistorical: true,
      }),
    ).toEqual([2, 1]);
  });
});

describe("resolveLockPoolClaim", () => {
  it("claims the live generation when that row is still unselected", () => {
    expect(
      resolveLockPoolClaim({
        date: "2026-09-09",
        currentGeneration: 2,
        historicalGeneration: 1,
        hasCurrentRow: true,
        currentSelectedForDate: null,
      }),
    ).toEqual({ generation: 2, alreadyClaimed: false });
  });

  it("does not stamp a leftover historical row after a live claim", () => {
    expect(
      resolveLockPoolClaim({
        date: "2026-09-09",
        currentGeneration: 2,
        historicalGeneration: 1,
        hasCurrentRow: true,
        currentSelectedForDate: "2026-09-09",
      }),
    ).toEqual({ generation: null, alreadyClaimed: true });
  });

  it("skips leftover historical rows when the live slot is spent on another day", () => {
    expect(
      resolveLockPoolClaim({
        date: "2026-09-09",
        currentGeneration: 2,
        historicalGeneration: 1,
        hasCurrentRow: true,
        currentSelectedForDate: "2026-08-18",
      }),
    ).toEqual({ generation: null, alreadyClaimed: false });
  });

  it("claims the date generation only when there is no live row", () => {
    expect(
      resolveLockPoolClaim({
        date: "2026-09-09",
        currentGeneration: 2,
        historicalGeneration: 1,
        hasCurrentRow: false,
        currentSelectedForDate: null,
      }),
    ).toEqual({ generation: 1, alreadyClaimed: false });
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
