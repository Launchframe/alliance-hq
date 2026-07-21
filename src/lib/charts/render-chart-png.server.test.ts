import { describe, expect, it } from "vitest";

import {
  fixtureThpHistoryEvents,
  fixtureVrProgressSeries,
} from "@/lib/charts/chart-preview-fixtures.shared";
import {
  renderThpHistoryChartPng,
  renderVrProgressChartPng,
} from "@/lib/charts/render-chart-png.server";

describe("render chart PNG", () => {
  it("renders VR progress PNG with PNG magic bytes", async () => {
    const now = new Date("2026-07-16T18:00:00.000Z");
    const fixture = fixtureVrProgressSeries(now);
    const png = await renderVrProgressChartPng({
      series: fixture.series,
      seasonKey: fixture.seasonKey,
      now,
      visibleCommanderIds: [fixture.series.find((row) => row.isViewer)!.commanderId],
    });
    expect(png).toBeTruthy();
    expect(png![0]).toBe(0x89);
    expect(png![1]).toBe(0x50);
    expect(png![2]).toBe(0x4e);
    expect(png![3]).toBe(0x47);
    expect(png!.length).toBeGreaterThan(5_000);
  });

  it("renders THP history PNG with PNG magic bytes", async () => {
    const png = await renderThpHistoryChartPng({
      events: fixtureThpHistoryEvents(),
    });
    expect(png).toBeTruthy();
    expect(png!.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(
      true,
    );
  });
});
