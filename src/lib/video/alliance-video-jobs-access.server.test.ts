import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionCanProcessVideo = vi.hoisted(() => vi.fn());
const loadSession = vi.hoisted(() => vi.fn());
const resolveSessionAllianceId = vi.hoisted(() => vi.fn());
const resolveHqAllianceIdFromStoredAllianceId = vi.hoisted(() => vi.fn());

vi.mock("@/lib/video/processor-slots.server", () => ({
  sessionCanProcessVideo,
}));

vi.mock("@/lib/session", () => ({
  loadSession: (...args: unknown[]) => loadSession(...args),
}));

vi.mock("@/lib/alliance/session-memberships", () => ({
  resolveSessionAllianceId: (...args: unknown[]) =>
    resolveSessionAllianceId(...args),
}));

vi.mock("@/lib/video/video-job-alliance.server", () => ({
  resolveHqAllianceIdFromStoredAllianceId: (...args: unknown[]) =>
    resolveHqAllianceIdFromStoredAllianceId(...args),
}));

const selectLimit = vi.hoisted(() => vi.fn());

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
      allianceId: "alliance_id",
    },
  },
}));

import {
  isAllianceVideoJobOpsDenied,
  loadAllianceScopedVideoJob,
  requireAllianceVideoJobOps,
} from "./alliance-video-jobs-access.server";

describe("requireAllianceVideoJobOps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when session id is missing", async () => {
    const result = await requireAllianceVideoJobOps(null);
    expect(isAllianceVideoJobOpsDenied(result)).toBe(true);
    expect((result as NextResponse).status).toBe(401);
  });

  it("returns 403 when caller cannot process video", async () => {
    sessionCanProcessVideo.mockResolvedValue(false);
    const result = await requireAllianceVideoJobOps("session-1");
    expect((result as NextResponse).status).toBe(403);
  });

  it("returns alliance context for processors", async () => {
    sessionCanProcessVideo.mockResolvedValue(true);
    loadSession.mockResolvedValue({ id: "session-1" });
    resolveSessionAllianceId.mockReturnValue("alliance-a");

    const result = await requireAllianceVideoJobOps("session-1");
    expect(isAllianceVideoJobOpsDenied(result)).toBe(false);
    expect(result).toEqual({ sessionId: "session-1", allianceId: "alliance-a" });
  });
});

describe("loadAllianceScopedVideoJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when job is missing", async () => {
    selectLimit.mockResolvedValue([]);
    const result = await loadAllianceScopedVideoJob("job-1", "alliance-a");
    expect(result).toEqual({ ok: false, status: 404 });
  });

  it("returns 404 when job belongs to another alliance", async () => {
    selectLimit.mockResolvedValue([
      { id: "job-1", allianceId: "stored-other" },
    ]);
    resolveHqAllianceIdFromStoredAllianceId.mockResolvedValue("alliance-b");

    const result = await loadAllianceScopedVideoJob("job-1", "alliance-a");
    expect(result).toEqual({ ok: false, status: 404 });
  });

  it("returns job when alliance matches session", async () => {
    const job = { id: "job-1", allianceId: "alliance-a", status: "failed" };
    selectLimit.mockResolvedValue([job]);
    resolveHqAllianceIdFromStoredAllianceId.mockResolvedValue("alliance-a");

    const result = await loadAllianceScopedVideoJob("job-1", "alliance-a");
    expect(result).toEqual({ ok: true, job });
  });
});
