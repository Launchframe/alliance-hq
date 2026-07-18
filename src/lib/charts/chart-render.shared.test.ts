import { describe, expect, it } from "vitest";

import {
  fixtureThpHistoryEvents,
  fixtureVrProgressSeries,
} from "@/lib/charts/chart-preview-fixtures.shared";
import { buildThpHistoryChartSvg } from "@/lib/thp/thp-history-chart-render.shared";
import { buildVrProgressChartSvg } from "@/lib/vr/vr-progress-chart-render.shared";

describe("buildVrProgressChartSvg", () => {
  it("renders a full SVG document with viewer series and now marker", () => {
    const now = new Date("2026-07-16T18:00:00.000Z");
    const fixture = fixtureVrProgressSeries(now);
    const svg = buildVrProgressChartSvg({
      series: fixture.series,
      seasonKey: fixture.seasonKey,
      width: 1200,
      height: 675,
      now,
      options: { labels: { nowLabel: "Now" } },
    });
    expect(svg).toBeTruthy();
    expect(svg).toContain("<svg");
    expect(svg).toContain("Now");
    expect(svg).toContain('fill="#0d1117"');
    expect(svg).toMatch(/path d="/);
  });

  it("returns null when every series is empty", () => {
    expect(
      buildVrProgressChartSvg({
        series: [
          {
            commanderId: "x",
            ashedMemberId: "x",
            memberName: "Empty",
            rank: 1,
            currentBaseVr: 0,
            isViewer: true,
            events: [],
          },
        ],
        seasonKey: "5",
      }),
    ).toBeNull();
  });

  it("formats axis labels with the requested locale", () => {
    const now = new Date("2026-07-16T18:00:00.000Z");
    const fixture = fixtureVrProgressSeries(now);
    const en = buildVrProgressChartSvg({
      series: fixture.series,
      seasonKey: fixture.seasonKey,
      now,
      locale: "en-US",
      options: { labels: { nowLabel: "Now" } },
    });
    const pt = buildVrProgressChartSvg({
      series: fixture.series,
      seasonKey: fixture.seasonKey,
      now,
      locale: "pt-BR",
      options: { labels: { nowLabel: "Agora" } },
    });
    expect(en).toContain("Now");
    expect(pt).toContain("Agora");
    expect(en).not.toEqual(pt);
  });
});

describe("buildThpHistoryChartSvg", () => {
  it("renders polyline history for two or more events", () => {
    const svg = buildThpHistoryChartSvg({
      events: fixtureThpHistoryEvents(),
      width: 1200,
      height: 675,
    });
    expect(svg).toBeTruthy();
    expect(svg).toContain("<polyline");
    expect(svg).toContain('stroke="#58a6ff"');
  });

  it("formats axis ticks with the requested locale", () => {
    const events = fixtureThpHistoryEvents();
    const en = buildThpHistoryChartSvg({ events, locale: "en-US" });
    const pt = buildThpHistoryChartSvg({ events, locale: "pt-BR" });
    expect(en).toBeTruthy();
    expect(pt).toBeTruthy();
    expect(en).not.toEqual(pt);
  });

  it("returns null with fewer than two events", () => {
    expect(
      buildThpHistoryChartSvg({
        events: [
          {
            total: 1,
            breakdown: null,
            previousTotal: null,
            createdAt: new Date().toISOString(),
            source: "manual",
          },
        ],
      }),
    ).toBeNull();
  });
});
