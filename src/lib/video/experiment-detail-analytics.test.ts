import { describe, expect, it } from "vitest";

import { buildExperimentDetailAnalytics } from "@/lib/video/experiment-detail-analytics";

describe("buildExperimentDetailAnalytics", () => {
  it("evaluates control primary jobs and variant shadow jobs separately", () => {
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
          configId: "cfg-scene-033",
          trafficWeight: 50,
          config: { name: "Scene 0.33", passKey: "scene_0.33" },
        },
      ],
      groups: [
        {
          id: "group-control",
          experimentArmId: "control-arm",
          scoreTarget: "zombie_siege",
          boardKey: "kills",
          hqEventId: "event-1",
        },
        {
          id: "group-variant",
          experimentArmId: "variant-arm",
          scoreTarget: "zombie_siege",
          boardKey: "kills",
          hqEventId: "event-1",
        },
      ],
      jobs: [
        {
          id: "control-primary",
          groupId: "group-control",
          passRole: "primary",
          passKey: "scene_0.25",
          rating: "down",
          qualityScore: 0.4,
          qualityBucket: "q4",
          createdAt: "2026-06-17T10:00:00Z",
        },
        {
          id: "variant-primary",
          groupId: "group-variant",
          passRole: "primary",
          passKey: "scene_0.25",
          rating: "down",
          qualityScore: 0.3,
          qualityBucket: "q5",
          createdAt: "2026-06-17T10:00:00Z",
        },
        {
          id: "variant-shadow",
          groupId: "group-variant",
          passRole: "shadow",
          passKey: "scene_0.33",
          rating: "up",
          qualityScore: 0.9,
          qualityBucket: "q1",
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
        avgQualityScore: 0.9,
        qualityBuckets: { q1: 1 },
      },
    ]);
    expect(result.dailySeries).toEqual([
      { date: "2026-06-17", armId: "control-arm", rated: 1, thumbsUp: 0 },
      { date: "2026-06-17", armId: "variant-arm", rated: 1, thumbsUp: 1 },
    ]);
    expect(result.population).toEqual([
      {
        scoreTarget: "zombie_siege",
        boardKey: "kills",
        hqEventId: "event-1",
        count: 2,
      },
    ]);
  });
});
