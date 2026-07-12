import { describe, expect, it } from "vitest";

import {
  computeKillsTotalGrowth,
  isKillsReportStale,
  resolveKillsLastReportedAt,
  killsChartYDomain,
  KILLS_STALE_REPORT_MS,
} from "@/lib/kills/my-kills-chart.shared";

describe("killsChartYDomain", () => {
  it("pads above and below so the min is not flush with the baseline", () => {
    const { min, max, span } = killsChartYDomain([161_351_358, 163_481_081]);
    expect(min).toBeLessThan(161_351_358);
    expect(max).toBeGreaterThan(163_481_081);
    expect(span).toBe(max - min);
  });
});

describe("computeKillsTotalGrowth", () => {
  it("returns last minus first when the series ends at its peak", () => {
    expect(
      computeKillsTotalGrowth([
        { total: 100, createdAt: "2026-01-01T00:00:00.000Z" },
        { total: 150, createdAt: "2026-01-02T00:00:00.000Z" },
      ]),
    ).toBe(50);
  });

  it("uses peak minus first when a later sync regresses the total", () => {
    expect(
      computeKillsTotalGrowth([
        { total: 161_351_358, createdAt: "2026-06-23T00:00:00.000Z" },
        { total: 163_481_081, createdAt: "2026-07-08T00:00:00.000Z" },
        { total: 161_351_358, createdAt: "2026-07-09T00:00:00.000Z" },
      ]),
    ).toBe(2_129_723);
  });
});

describe("isKillsReportStale", () => {
  it("is false when the last report is within 7 days", () => {
    const now = Date.parse("2026-07-11T18:00:00.000Z");
    expect(isKillsReportStale("2026-07-09T18:42:00.000Z", now)).toBe(false);
  });

  it("is true when the last report is at least 7 days ago", () => {
    const now = Date.parse("2026-07-11T18:00:00.000Z");
    const sevenDaysAgo = new Date(now - KILLS_STALE_REPORT_MS).toISOString();
    expect(isKillsReportStale(sevenDaysAgo, now)).toBe(true);
  });
});

describe("resolveKillsLastReportedAt", () => {
  it("prefers updatedAt, then the latest event", () => {
    expect(
      resolveKillsLastReportedAt({
        updatedAt: "2026-07-01T00:00:00.000Z",
        events: [{ createdAt: "2026-06-01T00:00:00.000Z" }],
      }),
    ).toBe("2026-07-01T00:00:00.000Z");
    expect(
      resolveKillsLastReportedAt({
        updatedAt: null,
        events: [
          { createdAt: "2026-06-01T00:00:00.000Z" },
          { createdAt: "2026-07-09T00:00:00.000Z" },
        ],
      }),
    ).toBe("2026-07-09T00:00:00.000Z");
  });
});
