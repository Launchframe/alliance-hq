import type { MyThpEvent } from "@/lib/thp/my-thp.shared";
import type { VrProgressCommanderSeries } from "@/lib/vr/vr-progress-chart.shared";

/** Deterministic fixture series for Discord chart preview / unit tests. */
export function fixtureVrProgressSeries(now = new Date()): {
  seasonKey: string;
  series: VrProgressCommanderSeries[];
} {
  const day = 24 * 60 * 60 * 1000;
  const at = (daysAgo: number) =>
    new Date(now.getTime() - daysAgo * day).toISOString();

  return {
    seasonKey: "5",
    series: [
      {
        commanderId: "cmd-viewer",
        ashedMemberId: "viewer-1",
        memberName: "Viewer",
        rank: 3,
        currentBaseVr: 3200,
        isViewer: true,
        events: [
          { at: at(21), baseVr: 2400, instituteLevel: 10 },
          { at: at(14), baseVr: 2700, instituteLevel: 11 },
          { at: at(7), baseVr: 3000, instituteLevel: 12 },
          { at: at(1), baseVr: 3200, instituteLevel: 12 },
        ],
      },
      {
        commanderId: "cmd-alpha",
        ashedMemberId: "alpha-1",
        memberName: "Alpha",
        rank: 1,
        currentBaseVr: 4100,
        isViewer: false,
        events: [
          { at: at(20), baseVr: 3500, instituteLevel: 13 },
          { at: at(10), baseVr: 3800, instituteLevel: 14 },
          { at: at(2), baseVr: 4100, instituteLevel: 15 },
        ],
      },
      {
        commanderId: "cmd-bravo",
        ashedMemberId: "bravo-1",
        memberName: "Bravo",
        rank: 2,
        currentBaseVr: 3600,
        isViewer: false,
        events: [
          { at: at(18), baseVr: 3000, instituteLevel: 12 },
          { at: at(9), baseVr: 3300, instituteLevel: 12 },
          { at: at(3), baseVr: 3600, instituteLevel: 13 },
        ],
      },
    ],
  };
}

export function fixtureThpHistoryEvents(now = new Date()): MyThpEvent[] {
  const day = 24 * 60 * 60 * 1000;
  const at = (daysAgo: number) =>
    new Date(now.getTime() - daysAgo * day).toISOString();
  return [
    {
      total: 48_000_000,
      breakdown: null,
      previousTotal: null,
      createdAt: at(28),
      source: "manual",
    },
    {
      total: 51_200_000,
      breakdown: null,
      previousTotal: 48_000_000,
      createdAt: at(14),
      source: "manual",
    },
    {
      total: 54_800_000,
      breakdown: null,
      previousTotal: 51_200_000,
      createdAt: at(3),
      source: "ocr",
    },
  ];
}
