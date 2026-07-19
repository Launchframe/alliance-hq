import { beforeEach, describe, expect, it, vi } from "vitest";

const selectLimit = vi.hoisted(() => vi.fn());
const updateReturning = vi.hoisted(() => vi.fn());
const eq = vi.hoisted(() => vi.fn((...args: unknown[]) => ({ eq: args })));
const and = vi.hoisted(() => vi.fn((...args: unknown[]) => ({ and: args })));
const lt = vi.hoisted(() => vi.fn((...args: unknown[]) => ({ lt: args })));

vi.mock("drizzle-orm", () => ({ eq, and, lt }));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: selectLimit,
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: updateReturning,
        }),
      }),
    }),
  }),
  schema: {
    videoJobs: {
      id: "id",
      status: "status",
      updatedAt: "updatedAt",
    },
  },
}));

import {
  recoverStaleSubmittingVideoJob,
  VIDEO_SUBMITTING_STALE_MS,
} from "@/lib/video/recover-stale-submitting-video-job.server";

describe("recoverStaleSubmittingVideoJob", () => {
  beforeEach(() => {
    selectLimit.mockReset();
    updateReturning.mockReset();
  });

  it("no-ops when job is not submitting", async () => {
    selectLimit.mockResolvedValueOnce([
      {
        id: "job-1",
        status: "review",
        updatedAt: new Date("2026-07-19T03:00:00.000Z"),
      },
    ]);

    const result = await recoverStaleSubmittingVideoJob("job-1", {
      nowMs: Date.parse("2026-07-19T04:00:00.000Z"),
    });

    expect(result).toEqual({ recovered: false, status: "review" });
    expect(updateReturning).not.toHaveBeenCalled();
  });

  it("no-ops when submitting is still fresh", async () => {
    selectLimit.mockResolvedValueOnce([
      {
        id: "job-1",
        status: "submitting",
        updatedAt: new Date("2026-07-19T03:59:00.000Z"),
      },
    ]);

    const result = await recoverStaleSubmittingVideoJob("job-1", {
      nowMs: Date.parse("2026-07-19T04:00:00.000Z"),
      staleAfterMs: VIDEO_SUBMITTING_STALE_MS,
    });

    expect(result).toEqual({ recovered: false, status: "submitting" });
    expect(updateReturning).not.toHaveBeenCalled();
  });

  it("resets stale submitting to review", async () => {
    selectLimit.mockResolvedValueOnce([
      {
        id: "job-1",
        status: "submitting",
        updatedAt: new Date("2026-07-19T03:50:00.000Z"),
      },
    ]);
    updateReturning.mockResolvedValueOnce([{ id: "job-1", status: "review" }]);

    const result = await recoverStaleSubmittingVideoJob("job-1", {
      nowMs: Date.parse("2026-07-19T04:00:00.000Z"),
      staleAfterMs: VIDEO_SUBMITTING_STALE_MS,
    });

    expect(result).toEqual({ recovered: true, status: "review" });
    expect(updateReturning).toHaveBeenCalled();
  });
});
