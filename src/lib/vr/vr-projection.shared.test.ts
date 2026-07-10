import { describe, expect, it } from "vitest";

import {
  fitPowerLawProjection,
  projectVrSeries,
} from "@/lib/vr/vr-projection.shared";

describe("VR projection", () => {
  it("fits a faster k for a spender than a grinder", () => {
    const grinder = fitPowerLawProjection(
      [
        { createdAt: "2026-07-01T00:00:00.000Z", baseVr: 100 },
        { createdAt: "2026-07-03T00:00:00.000Z", baseVr: 200 },
        { createdAt: "2026-07-07T00:00:00.000Z", baseVr: 300 },
      ],
      "1",
    );
    const spender = fitPowerLawProjection(
      [
        { createdAt: "2026-07-01T00:00:00.000Z", baseVr: 100 },
        { createdAt: "2026-07-02T00:00:00.000Z", baseVr: 200 },
        { createdAt: "2026-07-03T00:00:00.000Z", baseVr: 300 },
      ],
      "1",
    );

    expect(grinder).not.toBeNull();
    expect(spender).not.toBeNull();
    expect(spender!.k).toBeGreaterThan(grinder!.k);
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
