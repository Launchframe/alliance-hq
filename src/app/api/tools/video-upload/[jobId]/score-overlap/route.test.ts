import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const getOrCreateSessionMock = vi.fn();
const getAshedConnectionMock = vi.fn();
const resolveVideoJobAccessMock = vi.fn();
const videoJobAccessErrorResponseMock = vi.fn();
const findStormScoreOverlapMock = vi.fn();
const resolveSessionAllianceIdMock = vi.fn();

vi.mock("@/lib/session", () => ({
  getOrCreateSession: () => getOrCreateSessionMock(),
  getAshedConnection: (sessionId: string) => getAshedConnectionMock(sessionId),
}));

vi.mock("@/lib/alliance/session-memberships", () => ({
  resolveSessionAllianceId: (session: unknown) =>
    resolveSessionAllianceIdMock(session),
}));

vi.mock("@/lib/video/video-job-access.server", () => ({
  resolveVideoJobAccess: (
    jobId: string,
    sessionId: string,
    level: "read" | "mutate" | "process",
  ) => resolveVideoJobAccessMock(jobId, sessionId, level),
  videoJobAccessErrorResponse: (result: {
    ok: false;
    status: 403 | 404;
  }) => videoJobAccessErrorResponseMock(result),
}));

vi.mock("@/lib/video/storm-score-overlap.server", () => ({
  findStormScoreOverlap: (params: unknown) => findStormScoreOverlapMock(params),
}));

import { GET } from "./route";

const session = {
  id: "sess-1",
  currentAllianceId: "alliance-1",
};

const stormJob = {
  id: "job-1",
  scoreTarget: "desert-storm",
  category: "desert-storm",
  allianceId: "alliance-1",
};

function request(
  query: Record<string, string>,
  jobId = "job-1",
): { request: Request; params: Promise<{ jobId: string }> } {
  const params = new URLSearchParams(query);
  return {
    request: new Request(
      `http://localhost/api/tools/video-upload/${jobId}/score-overlap?${params}`,
    ),
    params: Promise.resolve({ jobId }),
  };
}

describe("GET /api/tools/video-upload/[jobId]/score-overlap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOrCreateSessionMock.mockResolvedValue(session);
    getAshedConnectionMock.mockResolvedValue(null);
    resolveSessionAllianceIdMock.mockReturnValue("alliance-1");
    resolveVideoJobAccessMock.mockResolvedValue({ ok: true, job: stormJob });
    videoJobAccessErrorResponseMock.mockImplementation(
      (result: { ok: false; status: 403 | 404 }) =>
        NextResponse.json(
          { error: result.status === 403 ? "Forbidden" : "Job not found" },
          { status: result.status },
        ),
    );
    findStormScoreOverlapMock.mockResolvedValue({
      overlaps: true,
      source: "hq",
    });
  });

  it("400s when team or recordedDate is missing", async () => {
    const { request: req, params } = request({ recordedDate: "2026-07-10" });
    const res = await GET(req, { params });
    expect(res.status).toBe(400);
    expect(findStormScoreOverlapMock).not.toHaveBeenCalled();
  });

  it("400s when recordedDate is not YYYY-MM-DD", async () => {
    const { request: req, params } = request({
      team: "A",
      recordedDate: "07/10/2026",
    });
    const res = await GET(req, { params });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "recordedDate must be YYYY-MM-DD.",
    });
    expect(findStormScoreOverlapMock).not.toHaveBeenCalled();
  });

  it("returns access error when resolveVideoJobAccess fails", async () => {
    resolveVideoJobAccessMock.mockResolvedValue({ ok: false, status: 404 });
    const { request: req, params } = request({
      team: "A",
      recordedDate: "2026-07-10",
    });
    const res = await GET(req, { params });
    expect(videoJobAccessErrorResponseMock).toHaveBeenCalledWith({
      ok: false,
      status: 404,
    });
    expect(res.status).toBe(404);
    expect(findStormScoreOverlapMock).not.toHaveBeenCalled();
  });

  it("returns no overlap for non-storm score targets", async () => {
    resolveVideoJobAccessMock.mockResolvedValue({
      ok: true,
      job: {
        ...stormJob,
        scoreTarget: "vs-performance",
        category: "vs-performance",
      },
    });
    const { request: req, params } = request({
      team: "A",
      recordedDate: "2026-07-10",
    });
    const res = await GET(req, { params });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      overlaps: false,
      source: null,
    });
    expect(findStormScoreOverlapMock).not.toHaveBeenCalled();
  });

  it("delegates to findStormScoreOverlap for storm jobs", async () => {
    const connection = { baseUrl: "https://ashed.test" };
    getAshedConnectionMock.mockResolvedValue(connection);
    findStormScoreOverlapMock.mockResolvedValue({
      overlaps: true,
      source: "ashed",
    });

    const { request: req, params } = request({
      team: "B",
      recordedDate: "2026-07-10",
      eventId: "event-1",
    });
    const res = await GET(req, { params });

    expect(resolveVideoJobAccessMock).toHaveBeenCalledWith(
      "job-1",
      "sess-1",
      "read",
    );
    expect(findStormScoreOverlapMock).toHaveBeenCalledWith({
      connection,
      allianceId: "alliance-1",
      scoreTargetId: "desert-storm",
      eventId: "event-1",
      team: "B",
      recordedDate: "2026-07-10",
      excludeJobId: "job-1",
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      overlaps: true,
      source: "ashed",
    });
  });
});
