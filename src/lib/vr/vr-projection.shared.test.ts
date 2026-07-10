import { describe, expect, it } from "vitest";

import {
  collapseReportingBursts,
  enforceMonotonicLevels,
  fitPowerLawProjection,
  prepareEventsForProjection,
  projectVrSeries,
} from "@/lib/vr/vr-projection.shared";

describe("VR projection prep", () => {
  it("drops erroneous dips so the series is monotonic in level", () => {
    const cleaned = enforceMonotonicLevels([
      { tMs: 1, baseVr: 2750, level: 14 },
      { tMs: 2, baseVr: 100, level: 1 },
      { tMs: 3, baseVr: 3250, level: 16 },
      { tMs: 4, baseVr: 3500, level: 17 },
    ]);
    expect(cleaned.map((e) => e.level)).toEqual([14, 16, 17]);
  });

  it("collapses wake-up double reports into one point", () => {
    const t0 = Date.parse("2026-07-10T16:56:13.000Z");
    const collapsed = collapseReportingBursts([
      { tMs: t0, baseVr: 3750, level: 18 },
      { tMs: t0 + 14_000, baseVr: 4000, level: 19 },
    ]);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]).toMatchObject({ level: 19, baseVr: 4000 });
    expect(collapsed[0]!.tMs).toBe(t0 + 14_000);
  });

  it("prepares JBeazy-like series without the 100 dip or 14s burst interval", () => {
    const prepared = prepareEventsForProjection(
      [
        { createdAt: "2026-07-08T15:45:22.000Z", baseVr: 2750, instituteLevel: 14 },
        { createdAt: "2026-07-09T11:31:22.000Z", baseVr: 100, instituteLevel: 1 },
        { createdAt: "2026-07-09T11:31:52.000Z", baseVr: 3250, instituteLevel: 16 },
        { createdAt: "2026-07-09T16:20:43.000Z", baseVr: 3500, instituteLevel: 17 },
        { createdAt: "2026-07-10T16:56:13.000Z", baseVr: 3750, instituteLevel: 18 },
        { createdAt: "2026-07-10T16:56:27.000Z", baseVr: 4000, instituteLevel: 19 },
      ],
      "5",
      "2026-07-10T20:00:00.000Z",
    );
    expect(prepared.map((e) => e.level)).toEqual([14, 16, 17, 19]);
    expect(prepared.every((e) => e.baseVr !== 100)).toBe(true);
  });
});

describe("VR projection", () => {
  it("fits a faster k for a spender than a grinder", () => {
    const grinder = fitPowerLawProjection(
      [
        { createdAt: "2026-07-01T00:00:00.000Z", baseVr: 100 },
        { createdAt: "2026-07-03T00:00:00.000Z", baseVr: 200 },
        { createdAt: "2026-07-07T00:00:00.000Z", baseVr: 300 },
      ],
      "1",
      "2026-07-07T00:00:00.000Z",
    );
    const spender = fitPowerLawProjection(
      [
        { createdAt: "2026-07-01T00:00:00.000Z", baseVr: 100 },
        { createdAt: "2026-07-02T00:00:00.000Z", baseVr: 200 },
        { createdAt: "2026-07-03T00:00:00.000Z", baseVr: 300 },
      ],
      "1",
      "2026-07-03T00:00:00.000Z",
    );

    expect(grinder).not.toBeNull();
    expect(spender).not.toBeNull();
    expect(spender!.k).toBeGreaterThan(grinder!.k);
  });

  it("does not instantly max out after an onboarding catch-up burst", () => {
    // Bat Pig pattern: 17 levels in ~40s, then real ~6-15h intervals.
    const events = [
      { createdAt: "2026-07-08T15:46:07.000Z", baseVr: 100, instituteLevel: 1 },
      { createdAt: "2026-07-08T15:46:12.000Z", baseVr: 200, instituteLevel: 2 },
      { createdAt: "2026-07-08T15:46:46.000Z", baseVr: 3800, instituteLevel: 17 },
      { createdAt: "2026-07-08T21:19:54.000Z", baseVr: 4200, instituteLevel: 18 },
      { createdAt: "2026-07-09T03:08:36.000Z", baseVr: 4600, instituteLevel: 19 },
      { createdAt: "2026-07-09T12:22:37.000Z", baseVr: 4250, instituteLevel: 20 },
      { createdAt: "2026-07-10T03:55:09.000Z", baseVr: 4500, instituteLevel: 21 },
      { createdAt: "2026-07-10T09:17:40.000Z", baseVr: 4750, instituteLevel: 22 },
      { createdAt: "2026-07-10T18:54:03.000Z", baseVr: 5000, instituteLevel: 23 },
    ];
    const projected = projectVrSeries({
      events,
      seasonKey: "5",
      now: "2026-07-10T20:00:00.000Z",
      horizonDays: 7,
      sampleCount: 8,
    });
    const maxVr = Math.max(...projected.map((p) => p.baseVr));
    // Season 5 max is 28000; a sane 7d projection from L23 should stay far below.
    expect(maxVr).toBeLessThan(12000);
    expect(projected[0]?.baseVr).toBe(5000);
  });

  it("does not step up across a reporting gap before now", () => {
    const projected = projectVrSeries({
      events: [
        { createdAt: "2026-07-08T12:00:00.000Z", baseVr: 4000, instituteLevel: 19 },
        { createdAt: "2026-07-09T12:00:00.000Z", baseVr: 4250, instituteLevel: 20 },
        { createdAt: "2026-07-10T12:00:00.000Z", baseVr: 4500, instituteLevel: 21 },
      ],
      seasonKey: "5",
      now: "2026-07-10T20:00:00.000Z",
      horizonDays: 1,
      sampleCount: 3,
    });
    expect(projected[0]?.at).toBe("2026-07-10T20:00:00.000Z");
    expect(projected[0]?.baseVr).toBe(4500);
  });

  it("clamps projection at the max institute level", () => {
    const projected = projectVrSeries({
      events: [
        { createdAt: "2026-07-01T00:00:00.000Z", baseVr: 9000 },
        { createdAt: "2026-07-02T00:00:00.000Z", baseVr: 9500 },
        { createdAt: "2026-07-03T00:00:00.000Z", baseVr: 10000 },
      ],
      seasonKey: "1",
      now: "2026-07-03T00:00:00.000Z",
      horizonDays: 30,
      sampleCount: 4,
    });

    expect(projected.at(-1)?.baseVr).toBe(10000);
  });

  it("stays flat when only one event is available", () => {
    const projected = projectVrSeries({
      events: [{ createdAt: "2026-07-01T00:00:00.000Z", baseVr: 500 }],
      seasonKey: "1",
      now: "2026-07-02T00:00:00.000Z",
      horizonDays: 3,
      sampleCount: 4,
    });

    expect(projected.map((point) => point.baseVr)).toEqual([500, 500, 500, 500]);
  });

  it("samples through the requested horizon", () => {
    const projected = projectVrSeries({
      events: [{ createdAt: "2026-07-01T00:00:00.000Z", baseVr: 500 }],
      seasonKey: "1",
      now: "2026-07-02T00:00:00.000Z",
      horizonDays: 3,
      sampleCount: 5,
    });

    expect(projected).toHaveLength(5);
    expect(projected[0]?.at).toBe("2026-07-02T00:00:00.000Z");
    expect(projected.at(-1)?.at).toBe("2026-07-05T00:00:00.000Z");
  });
});
