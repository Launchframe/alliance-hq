import { describe, expect, it } from "vitest";

import { parseConductorHistoryQueryParams } from "@/lib/trains/conductor-history-query.shared";

describe("parseConductorHistoryQueryParams", () => {
  it("defaults limit and offset", () => {
    const parsed = parseConductorHistoryQueryParams(new URLSearchParams());
    expect(parsed.limit).toBe(30);
    expect(parsed.offset).toBe(0);
  });

  it("parses filters and caps limit", () => {
    const parsed = parseConductorHistoryQueryParams(
      new URLSearchParams({
        limit: "500",
        offset: "15",
        dateFrom: "2026-01-01",
        dateTo: "2026-03-01",
        memberId: "mem-1",
        allianceRank: "3",
      }),
    );
    expect(parsed).toEqual({
      limit: 100,
      offset: 15,
      dateFrom: "2026-01-01",
      dateTo: "2026-03-01",
      memberId: "mem-1",
      allianceRank: 3,
    });
  });

  it("drops invalid dates and ranks", () => {
    const parsed = parseConductorHistoryQueryParams(
      new URLSearchParams({
        dateFrom: "not-a-date",
        allianceRank: "9",
      }),
    );
    expect(parsed.dateFrom).toBeUndefined();
    expect(parsed.allianceRank).toBeUndefined();
  });
});
