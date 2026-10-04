import { describe, expect, it } from "vitest";

import { buildThpHistorySeriesFromEvents } from "@/lib/analytics/thp-history-series.shared";

describe("buildThpHistorySeriesFromEvents", () => {
  it("returns empty when there are no positive events", () => {
    expect(
      buildThpHistorySeriesFromEvents(
        [{ commanderId: "a", total: 0, recordedDate: "2026-08-01" }],
        { startDate: null, endDate: "2026-08-03" },
      ),
    ).toEqual([]);
  });

  it("carries latest totals forward across days", () => {
    const series = buildThpHistorySeriesFromEvents(
      [
        { commanderId: "a", total: 100, recordedDate: "2026-08-01" },
        { commanderId: "b", total: 200, recordedDate: "2026-08-01" },
        { commanderId: "a", total: 150, recordedDate: "2026-08-03" },
      ],
      { startDate: "2026-08-01", endDate: "2026-08-03" },
    );

    expect(series.map((row) => row.recordedDate)).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
    ]);
    expect(series[0]?.thpTotal).toBe(300);
    expect(series[1]?.thpTotal).toBe(300);
    expect(series[2]?.thpTotal).toBe(350);
  });

  it("uses the last event on a day when a commander updates twice", () => {
    const series = buildThpHistorySeriesFromEvents(
      [
        { commanderId: "a", total: 100, recordedDate: "2026-08-01" },
        { commanderId: "a", total: 120, recordedDate: "2026-08-01" },
      ],
      { startDate: "2026-08-01", endDate: "2026-08-01" },
    );

    expect(series).toHaveLength(1);
    expect(series[0]?.thpTotal).toBe(120);
  });

  it("replays events before startDate so window carry-forward is correct", () => {
    const series = buildThpHistorySeriesFromEvents(
      [
        { commanderId: "a", total: 100, recordedDate: "2026-07-01" },
        { commanderId: "b", total: 50, recordedDate: "2026-07-15" },
      ],
      { startDate: "2026-08-01", endDate: "2026-08-02" },
    );

    expect(series).toHaveLength(2);
    expect(series[0]?.thpTotal).toBe(150);
    expect(series[1]?.thpTotal).toBe(150);
  });
});
