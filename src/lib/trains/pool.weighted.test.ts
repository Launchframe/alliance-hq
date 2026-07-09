import { describe, expect, it, vi } from "vitest";

import { pickWeightedPoolEntryFromRows } from "@/lib/trains/pool";

describe("pickWeightedPoolEntryFromRows", () => {
  it("falls back to uniform pick when ticket weights are missing", () => {
    const rows = [
      { id: "a", ticketCount: null },
      { id: "b", ticketCount: null },
    ];
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(pickWeightedPoolEntryFromRows(rows)?.id).toBe("a");
    vi.restoreAllMocks();
  });

  it("excludes zero-ticket rows from weighted picks", () => {
    const rows = [
      { id: "ineligible", ticketCount: 0 },
      { id: "eligible", ticketCount: 1 },
    ];
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(pickWeightedPoolEntryFromRows(rows)?.id).toBe("eligible");
    vi.restoreAllMocks();
  });

  it("returns null when all eligible rows have zero tickets (e.g. no VS scores from null connection)", () => {
    const rows = [
      { id: "a", ticketCount: 0 },
      { id: "b", ticketCount: 0 },
    ];
    expect(pickWeightedPoolEntryFromRows(rows)).toBeNull();
  });

  it("favors higher ticket counts over many draws", () => {
    const rows = [
      { id: "low", ticketCount: 1 },
      { id: "high", ticketCount: 99 },
    ];
    let highWins = 0;
    for (let i = 0; i < 200; i += 1) {
      const picked = pickWeightedPoolEntryFromRows(rows);
      if (picked?.id === "high") highWins += 1;
    }
    expect(highWins).toBeGreaterThan(150);
  });
});
