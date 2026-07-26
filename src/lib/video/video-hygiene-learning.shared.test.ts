import { describe, expect, it } from "vitest";

import {
  detectAdaptOscillation,
  detectCoachSpam,
  detectCrossSignalConflict,
  detectWorseningAfterAdapt,
  learningDirectionFromWindows,
} from "./video-hygiene-learning.shared";

describe("learningDirectionFromWindows", () => {
  it("marks improving when late rewards rise", () => {
    expect(
      learningDirectionFromWindows({
        earlyThumbsUpRate: 0.4,
        lateThumbsUpRate: 0.7,
        earlyAvgQuality: 0.4,
        lateAvgQuality: 0.6,
      }),
    ).toBe("improving");
  });

  it("marks regressing when late rewards fall", () => {
    expect(
      learningDirectionFromWindows({
        earlyThumbsUpRate: 0.8,
        lateThumbsUpRate: 0.4,
        earlyAvgQuality: 0.7,
        lateAvgQuality: 0.4,
      }),
    ).toBe("regressing");
  });
});

describe("thrash detectors", () => {
  it("flags adapt oscillation", () => {
    const flags = detectAdaptOscillation({
      hqUserId: "u1",
      events: [
        { kind: "adapt_bias_on", scoreTarget: "vs", createdAt: "2026-01-01", payload: null },
        { kind: "adapt_bias_off", scoreTarget: "vs", createdAt: "2026-01-02", payload: null },
        { kind: "adapt_bias_on", scoreTarget: "vs", createdAt: "2026-01-03", payload: null },
        { kind: "adapt_bias_off", scoreTarget: "vs", createdAt: "2026-01-04", payload: null },
      ],
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]!.kind).toBe("adapt_oscillation");
  });

  it("flags coach spam when still poor", () => {
    const events = Array.from({ length: 4 }, (_, i) => ({
      kind: "coach_shown",
      scoreTarget: "vs",
      createdAt: `2026-01-0${i + 1}`,
      payload: { tipId: "chaoticScroll" },
    }));
    expect(
      detectCoachSpam({
        hqUserId: "u1",
        events,
        thumbsUpRate: 0.3,
        avgQualityScore: 0.3,
      }),
    ).toHaveLength(1);
    expect(
      detectCoachSpam({
        hqUserId: "u1",
        events,
        thumbsUpRate: 0.9,
        avgQualityScore: 0.9,
      }),
    ).toHaveLength(0);
  });

  it("flags worsening after adapt", () => {
    expect(
      detectWorseningAfterAdapt({
        hqUserId: "u1",
        scoreTarget: "vs",
        hadAdaptOn: true,
        earlyThumbsUpRate: 0.7,
        lateThumbsUpRate: 0.3,
        earlyAvgQuality: 0.7,
        lateAvgQuality: 0.3,
      })?.kind,
    ).toBe("worsening_after_adapt");
  });

  it("flags cross-signal conflict", () => {
    const flags = detectCrossSignalConflict({
      hqUserId: "u1",
      adaptBiasOnTargets: new Set(["vs"]),
      events: [
        {
          kind: "coach_shown",
          scoreTarget: "vs",
          createdAt: "2026-01-01",
          payload: { tipId: "chaoticScroll" },
        },
      ],
    });
    expect(flags[0]!.kind).toBe("cross_signal_conflict");
  });
});
