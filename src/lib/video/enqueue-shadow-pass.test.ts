import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  selectCallIndex: 0,
  insertedValues: [] as unknown[],
}));

const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => {
          const result = mockState.selectResults[mockState.selectCallIndex] ?? [];
          mockState.selectCallIndex += 1;
          return result;
        }),
      })),
    })),
  })),
  insert: vi.fn(() => ({
    values: vi.fn(async (values: unknown) => {
      mockState.insertedValues.push(values);
    }),
  })),
}));

const dispatchVideoProcessing = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...clauses: unknown[]) => clauses),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
}));

vi.mock("nanoid", () => ({
  nanoid: () => "shadow-job-id",
}));

vi.mock("@/lib/db", () => ({
  getDb: () => mockDb,
  schema: {
    videoJobs: {
      id: "videoJobs.id",
      groupId: "videoJobs.groupId",
      passKey: "videoJobs.passKey",
      passRole: "videoJobs.passRole",
    },
    videoUploadGroups: {
      id: "videoUploadGroups.id",
      experimentArmId: "videoUploadGroups.experimentArmId",
    },
    experimentArms: {
      id: "experimentArms.id",
      configId: "experimentArms.configId",
    },
    parseConfigs: {
      id: "parseConfigs.id",
      passKey: "parseConfigs.passKey",
      configJson: "parseConfigs.configJson",
    },
  },
}));

vi.mock("@/lib/video/trigger-processing", () => ({
  dispatchVideoProcessing,
}));

import {
  isShadowEligible,
  maybeEnqueueShadowPass,
} from "@/lib/video/enqueue-shadow-pass";

beforeEach(() => {
  mockState.selectResults = [];
  mockState.selectCallIndex = 0;
  mockState.insertedValues = [];
  mockDb.select.mockClear();
  mockDb.insert.mockClear();
  dispatchVideoProcessing.mockClear();
});

/** Default: no existing shadow, group has no experiment arm */
function mockNoExperimentShadowPath() {
  mockState.selectResults = [[], [{ experimentArmId: null }]];
}

describe("isShadowEligible", () => {
  it("is eligible for fast primary jobs with few frames", () => {
    const result = isShadowEligible({
      totalMs: 10_000,
      frameCount: 5,
      passRole: "primary",
    });
    expect(result.eligible).toBe(true);
    expect(result.reason).toBe("eligible");
  });

  it("is not eligible for non-primary pass role: shadow", () => {
    const result = isShadowEligible({ totalMs: 5000, frameCount: 3, passRole: "shadow" });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("not_primary");
  });

  it("is not eligible for non-primary pass role: null", () => {
    const result = isShadowEligible({ totalMs: 5000, frameCount: 3, passRole: null });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("not_primary");
  });

  it("is not eligible when totalMs >= 30000", () => {
    const result = isShadowEligible({ totalMs: 30_000, frameCount: 3, passRole: "primary" });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("too_slow");
  });

  it("is not eligible when frameCount >= 12", () => {
    const result = isShadowEligible({ totalMs: 5000, frameCount: 12, passRole: "primary" });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("too_many_frames");
  });

  it("is eligible at exactly the boundary (< 30s, < 12 frames)", () => {
    const result = isShadowEligible({ totalMs: 29_999, frameCount: 11, passRole: "primary" });
    expect(result.eligible).toBe(true);
    expect(result.reason).toBe("eligible");
  });

  it("prioritizes not_primary check over other conditions", () => {
    const result = isShadowEligible({ totalMs: 99_999, frameCount: 99, passRole: "shadow" });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("not_primary");
  });
});

describe("maybeEnqueueShadowPass", () => {
  const primaryJob = {
    id: "primary-job",
    sessionId: "session-1",
    allianceId: "alliance-1",
    scoreTarget: "desert-storm",
    category: "desert-storm",
    storageKey: "videos/primary/source.mp4",
    boardKey: null,
    hqEventId: null,
    groupId: "group-1",
    passRole: "primary",
    frameCount: null,
    hqUserId: "user-1",
  };

  it("uses the extracted frame count when the loaded job row is stale", async () => {
    await maybeEnqueueShadowPass({
      job: primaryJob,
      totalMs: 5000,
      frameCount: 12,
    });

    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(dispatchVideoProcessing).not.toHaveBeenCalled();
  });

  it("inserts shadow job and dispatches when all eligibility criteria are met", async () => {
    mockNoExperimentShadowPath();

    await maybeEnqueueShadowPass({
      job: primaryJob,
      totalMs: 5000,
      frameCount: 5,
    });

    expect(mockDb.insert).toHaveBeenCalledOnce();
    const insertedValues = mockState.insertedValues[0] as Record<string, unknown>;
    expect(insertedValues.passRole).toBe("shadow");
    expect(insertedValues.passKey).toBe("scene_0.1");
    expect(insertedValues.groupId).toBe("group-1");
    expect(insertedValues.sessionId).toBe("session-1");
    expect(insertedValues.status).toBe("queued");

    // dispatch is fire-and-forget (void), so we just check it was called
    await Promise.resolve(); // flush microtasks
    expect(dispatchVideoProcessing).toHaveBeenCalledWith("shadow-job-id", { source: "shadow_pass" });
  });

  it("skips insert when an existing shadow job already exists for the group", async () => {
    mockState.selectResults = [[{ id: "existing-shadow-id" }]];

    await maybeEnqueueShadowPass({
      job: primaryJob,
      totalMs: 5000,
      frameCount: 5,
    });

    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(dispatchVideoProcessing).not.toHaveBeenCalled();
  });
});
