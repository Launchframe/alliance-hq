import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  selectResult: [] as Array<{ id: string }>,
  insertedValues: [] as unknown[],
}));

const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => mockState.selectResult),
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
  mockState.selectResult = [];
  mockState.insertedValues = [];
  mockDb.select.mockClear();
  mockDb.insert.mockClear();
  dispatchVideoProcessing.mockClear();
});

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
});
