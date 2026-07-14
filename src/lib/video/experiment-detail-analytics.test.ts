import { describe, expect, it } from "vitest";

import { buildExperimentDetailAnalytics } from "@/lib/video/experiment-detail-analytics";

describe("buildExperimentDetailAnalytics", () => {
  it("evaluates the primary job for every arm (not variant shadows)", () => {
    const result = buildExperimentDetailAnalytics({
      arms: [
        {
          id: "control-arm",
          name: "Control",
          isControl: true,
          configId: null,
          trafficWeight: 50,
          config: null,
        },
        {
          id: "variant-arm",
          name: "Variant",
          isControl: false,
          configId: "cfg-fps-3",
          trafficWeight: 50,
          config: { name: "FPS 3", passKey: "fps_3" },
        },
      ],
      groups: [
        {
          id: "group-control",
          experimentArmId: "control-arm",
          scoreTarget: "bank-deposit-slip-history",
          boardKey: null,
          hqEventId: "event-1",
        },
        {
          id: "group-variant",
          experimentArmId: "variant-arm",
          scoreTarget: "bank-deposit-slip-history",
          boardKey: null,
          hqEventId: "event-1",
        },
      ],
      jobs: [
        {
          id: "control-primary",
          groupId: "group-control",
          passRole: "primary",
          passKey: "scene_0.25",
          rating: "thumbs_down",
          qualityScore: 0.4,
          qualityBucket: "q4",
          createdAt: "2026-06-17T10:00:00Z",
        },
        {
          id: "variant-primary",
          groupId: "group-variant",
          passRole: "primary",
          passKey: "fps_3",
          rating: "thumbs_up",
          qualityScore: 0.85,
          qualityBucket: "q1",
          createdAt: "2026-06-17T10:00:00Z",
        },
        {
          id: "variant-shadow",
          groupId: "group-variant",
          passRole: "shadow",
          passKey: "scene_0.1",
          rating: null,
          qualityScore: 0.99,
          qualityBucket: "perfect",
          createdAt: "2026-06-17T11:00:00Z",
        },
      ],
    });

    expect(result.arms).toMatchObject([
      {
        id: "control-arm",
        jobCount: 1,
        ratedCount: 1,
        thumbsUpCount: 0,
        avgQualityScore: 0.4,
        qualityBuckets: { q4: 1 },
      },
      {
        id: "variant-arm",
        jobCount: 1,
        ratedCount: 1,
        thumbsUpCount: 1,
        avgQualityScore: 0.85,
        qualityBuckets: { q1: 1 },
      },
    ]);
    expect(result.dailySeries).toEqual([
      { date: "2026-06-17", armId: "control-arm", rated: 1, thumbsUp: 0 },
      { date: "2026-06-17", armId: "variant-arm", rated: 1, thumbsUp: 1 },
    ]);
    expect(result.population).toEqual([
      {
        scoreTarget: "bank-deposit-slip-history",
        boardKey: null,
        hqEventId: "event-1",
        count: 2,
      },
    ]);
  });

  it("counts legacy up ratings as thumbs-up for backward compatibility", () => {
    const result = buildExperimentDetailAnalytics({
      arms: [
        {
          id: "arm-a",
          name: "A",
          isControl: true,
          configId: null,
          trafficWeight: 100,
          config: null,
        },
      ],
      groups: [
        {
          id: "g1",
          experimentArmId: "arm-a",
          scoreTarget: "desert-storm",
          boardKey: null,
          hqEventId: null,
        },
      ],
      jobs: [
        {
          id: "j1",
          groupId: "g1",
          passRole: "primary",
          passKey: "scene_0.25",
          rating: "up",
          qualityScore: 1,
          qualityBucket: "perfect",
          createdAt: "2026-06-17T10:00:00Z",
        },
      ],
    });

    expect(result.arms[0]?.thumbsUpCount).toBe(1);
  });
});
