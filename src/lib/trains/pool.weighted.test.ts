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
