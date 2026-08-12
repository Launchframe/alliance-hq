import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const requireApiSessionMock = vi.fn();
const resolveVideoJobAccessMock = vi.fn();
const videoJobAccessErrorResponseMock = vi.fn();
const resolveSessionAllianceIdMock = vi.fn();
const fetchAllianceVsDay1To5CoverageForDay6Mock = vi.fn();

vi.mock("@/lib/session", () => ({
  requireApiSession: () => requireApiSessionMock(),
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

vi.mock("@/lib/trains/vs-scores.server", () => ({
  fetchAllianceVsDay1To5CoverageForDay6: (
    allianceId: string,
    day6RecordedDate: string,
  ) =>
    fetchAllianceVsDay1To5CoverageForDay6Mock(allianceId, day6RecordedDate),
}));

import { GET } from "./route";

const session = {
  id: "sess-1",
  currentAllianceId: "alliance-1",
};

const vsJob = {
  id: "job-1",
  scoreTarget: "vs-performance",
  category: "vs-performance",
  allianceId: "alliance-1",
};

function request(
  query: Record<string, string>,
  jobId = "job-1",
): { request: Request; params: Promise<{ jobId: string }> } {
  const params = new URLSearchParams(query);
  return {
    request: new Request(
      `http://localhost/api/tools/video-upload/${jobId}/vs-day6-totals?${params}`,
    ),
    params: Promise.resolve({ jobId }),
  };
}

describe("GET /api/tools/video-upload/[jobId]/vs-day6-totals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValue(session);
    resolveSessionAllianceIdMock.mockReturnValue("alliance-1");
    resolveVideoJobAccessMock.mockResolvedValue({ ok: true, job: vsJob });
    videoJobAccessErrorResponseMock.mockImplementation(
      (result: { ok: false; status: 403 | 404 }) =>
        NextResponse.json(
          { error: result.status === 403 ? "Forbidden" : "Job not found" },
          { status: result.status },
        ),
    );
    fetchAllianceVsDay1To5CoverageForDay6Mock.mockResolvedValue(
      new Map([["m1", { total: 100_000_000, daysCovered: 5 }]]),
    );
  });

  it("400s when recordedDate is missing", async () => {
    const { request: req, params } = request({});
    const res = await GET(req, { params });
    expect(res.status).toBe(400);
    expect(fetchAllianceVsDay1To5CoverageForDay6Mock).not.toHaveBeenCalled();
  });

  it("400s when recordedDate is not YYYY-MM-DD", async () => {
    const { request: req, params } = request({
      recordedDate: "08/08/2026",
    });
    const res = await GET(req, { params });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "recordedDate must be YYYY-MM-DD.",
    });
  });

  it("400s when recordedDate is not a weekly Sunday", async () => {
    const { request: req, params } = request({
      recordedDate: "2026-08-08",
    });
    const res = await GET(req, { params });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "recordedDate must be a weekly VS week-ending Sunday.",
    });
    expect(fetchAllianceVsDay1To5CoverageForDay6Mock).not.toHaveBeenCalled();
  });

  it("returns access error when resolveVideoJobAccess fails", async () => {
    resolveVideoJobAccessMock.mockResolvedValue({ ok: false, status: 404 });
    const { request: req, params } = request({
      recordedDate: "2026-08-09",
    });
    const res = await GET(req, { params });
    expect(videoJobAccessErrorResponseMock).toHaveBeenCalledWith({
      ok: false,
      status: 404,
    });
    expect(res.status).toBe(404);
  });

  it("returns Day 1–5 coverage totals for a weekly Sunday date", async () => {
    const { request: req, params } = request({
      recordedDate: "2026-08-09",
    });
    const res = await GET(req, { params });
    expect(res.status).toBe(200);
    expect(fetchAllianceVsDay1To5CoverageForDay6Mock).toHaveBeenCalledWith(
      "alliance-1",
      "2026-08-08",
    );
    await expect(res.json()).resolves.toEqual({
      totals: {
        m1: { total: 100_000_000, daysCovered: 5 },
      },
    });
  });
});
