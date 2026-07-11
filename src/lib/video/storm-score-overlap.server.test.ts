import { beforeEach, describe, expect, it, vi } from "vitest";

const base44Json = vi.hoisted(() => vi.fn());
const selectLimit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/base44/fetch", () => ({
  base44Json,
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: selectLimit,
        }),
      }),
    }),
  }),
  schema: {
    videoJobs: {
      id: "id",
      allianceId: "allianceId",
      scoreTarget: "scoreTarget",
      team: "team",
      recordedDate: "recordedDate",
      status: "status",
    },
  },
}));

import type { ParsedConnection } from "@/lib/connectionString";
import { findStormScoreOverlap } from "@/lib/video/storm-score-overlap.server";

const connection = {
  baseUrl: "https://ashed.test",
  token: "token",
  appId: "app",
  originUrl: "https://ashed.test",
} as ParsedConnection;

describe("findStormScoreOverlap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectLimit.mockResolvedValue([]);
  });

  it("returns false for non-storm score targets", async () => {
    const result = await findStormScoreOverlap({
      connection: null,
      allianceId: "alliance-1",
      scoreTargetId: "vs-performance",
      eventId: null,
      team: "A",
      recordedDate: "2026-07-10",
    });

    expect(result).toEqual({ overlaps: false, source: null });
    expect(base44Json).not.toHaveBeenCalled();
    expect(selectLimit).not.toHaveBeenCalled();
  });

  it("detects overlap from Ashed rows", async () => {
    base44Json.mockResolvedValue([
      { team: "B", recorded_date: "2026-07-10" },
    ]);

    const result = await findStormScoreOverlap({
      connection,
      allianceId: "alliance-1",
      scoreTargetId: "desert-storm",
      eventId: "event-1",
      team: "B",
      recordedDate: "2026-07-10",
    });

    expect(result).toEqual({ overlaps: true, source: "ashed" });
    expect(selectLimit).not.toHaveBeenCalled();
  });

  it("trusts Ashed when eventId is set and does not fall through to HQ", async () => {
    base44Json.mockResolvedValue([
      { team: "A", recorded_date: "2026-07-10" },
    ]);
    selectLimit.mockResolvedValue([{ id: "other-job" }]);

    const result = await findStormScoreOverlap({
      connection,
      allianceId: "alliance-1",
      scoreTargetId: "desert-storm",
      eventId: "event-2",
      team: "B",
      recordedDate: "2026-07-10",
    });

    expect(result).toEqual({ overlaps: false, source: null });
    expect(selectLimit).not.toHaveBeenCalled();
  });

  it("falls back to HQ jobs when Ashed is unreachable", async () => {
    base44Json.mockRejectedValue(new Error("network"));
    selectLimit.mockResolvedValue([{ id: "prior-job" }]);

    const result = await findStormScoreOverlap({
      connection,
      allianceId: "alliance-1",
      scoreTargetId: "canyon-storm",
      eventId: "event-1",
      team: "A",
      recordedDate: "2026-07-10",
      excludeJobId: "current-job",
    });

    expect(result).toEqual({ overlaps: true, source: "hq" });
  });

  it("detects overlap from completed HQ jobs without Ashed", async () => {
    selectLimit.mockResolvedValue([{ id: "prior-job" }]);

    const result = await findStormScoreOverlap({
      connection: null,
      allianceId: "alliance-1",
      scoreTargetId: "desert-storm",
      eventId: null,
      team: "A",
      recordedDate: "2026-07-10",
      excludeJobId: "current-job",
    });

    expect(result).toEqual({ overlaps: true, source: "hq" });
    expect(base44Json).not.toHaveBeenCalled();
  });
});
