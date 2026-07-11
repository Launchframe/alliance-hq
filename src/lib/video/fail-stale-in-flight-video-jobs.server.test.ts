import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();
const mockMarkVideoJobFailed = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: mockSelect,
  }),
  schema: {
    videoJobs: {
      id: "id",
      status: "status",
      updatedAt: "updatedAt",
    },
  },
}));

vi.mock("@/lib/video/mark-video-job-failed", () => ({
  markVideoJobFailed: (...args: unknown[]) => mockMarkVideoJobFailed(...args),
}));

import {
  failStaleInFlightVideoJobs,
  isVideoInFlightStale,
  STALE_IN_FLIGHT_FAILURE_MESSAGE,
  VIDEO_IN_FLIGHT_STALE_MS,
} from "@/lib/video/fail-stale-in-flight-video-jobs.server";

describe("isVideoInFlightStale", () => {
  it("is false within the stale window", () => {
    const now = Date.parse("2026-07-11T18:15:00.000Z");
    const updatedAt = new Date(now - VIDEO_IN_FLIGHT_STALE_MS + 60_000);
    expect(isVideoInFlightStale(updatedAt, now)).toBe(false);
  });

  it("is true once updatedAt is at least the stale threshold old", () => {
    const now = Date.parse("2026-07-11T18:15:00.000Z");
    const updatedAt = new Date(now - VIDEO_IN_FLIGHT_STALE_MS);
    expect(isVideoInFlightStale(updatedAt, now)).toBe(true);
  });
});

describe("failStaleInFlightVideoJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLimit.mockResolvedValue([]);
    mockWhere.mockReturnValue({ limit: mockLimit });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });
    mockMarkVideoJobFailed.mockResolvedValue(true);
  });

  it("marks stale extracting/parsing jobs failed with the timeout message", async () => {
    const now = Date.parse("2026-07-11T18:15:00.000Z");
    mockLimit.mockResolvedValue([
      {
        id: "job-parse",
        status: "parsing",
        updatedAt: new Date(now - VIDEO_IN_FLIGHT_STALE_MS - 1),
      },
      {
        id: "job-extract",
        status: "extracting",
        updatedAt: new Date(now - VIDEO_IN_FLIGHT_STALE_MS - 1),
      },
    ]);

    const result = await failStaleInFlightVideoJobs({ nowMs: now });

    expect(result.failedJobIds).toEqual(["job-parse", "job-extract"]);
    expect(mockMarkVideoJobFailed).toHaveBeenCalledTimes(2);
    expect(mockMarkVideoJobFailed).toHaveBeenCalledWith(
      "job-parse",
      STALE_IN_FLIGHT_FAILURE_MESSAGE,
      { onlyIfStatuses: ["extracting", "parsing"] },
    );
  });

  it("returns no jobs when none are stale", async () => {
    const result = await failStaleInFlightVideoJobs({
      nowMs: Date.parse("2026-07-11T18:15:00.000Z"),
    });
    expect(result.failedJobIds).toEqual([]);
    expect(mockMarkVideoJobFailed).not.toHaveBeenCalled();
  });

  it("omits jobs when markVideoJobFailed rejects a status race", async () => {
    const now = Date.parse("2026-07-11T18:15:00.000Z");
    mockLimit.mockResolvedValue([
      {
        id: "job-finished",
        status: "parsing",
        updatedAt: new Date(now - VIDEO_IN_FLIGHT_STALE_MS - 1),
      },
    ]);
    mockMarkVideoJobFailed.mockResolvedValue(false);

    const result = await failStaleInFlightVideoJobs({ nowMs: now });

    expect(result.failedJobIds).toEqual([]);
    expect(mockMarkVideoJobFailed).toHaveBeenCalledWith(
      "job-finished",
      STALE_IN_FLIGHT_FAILURE_MESSAGE,
      { onlyIfStatuses: ["extracting", "parsing"] },
    );
  });
});
