import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const getOrCreateSessionMock = vi.fn();
const resolveVideoJobAccessMock = vi.fn();
const videoJobAccessErrorResponseMock = vi.fn();
const resolveHqAllianceIdFromStoredAllianceIdMock = vi.fn();
const requireAlliancePermissionMock = vi.fn();
const parseSessionLimitMock = vi.fn();
const parsedRowsOrderByMock = vi.fn();

vi.mock("@/lib/session", () => ({
  getOrCreateSession: () => getOrCreateSessionMock(),
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

vi.mock("@/lib/video/video-job-alliance.server", () => ({
  resolveHqAllianceIdFromStoredAllianceId: (allianceId: string | null) =>
    resolveHqAllianceIdFromStoredAllianceIdMock(allianceId),
}));

vi.mock("@/lib/rbac/require-permission", () => ({
  requireAlliancePermission: (
    sessionId: string,
    allianceId: string,
    permission: string,
  ) => requireAlliancePermissionMock(sessionId, allianceId, permission),
}));

vi.mock("@/lib/video/score-targets", () => ({
  getScoreTarget: () => ({ id: "bank-deposit-slip-history" }),
  isBankDepositSlipHistoryTarget: (id: string) =>
    id === "bank-deposit-slip-history",
  isMemberRosterVideoTarget: () => false,
  toScoreTargetClientMeta: () => ({ id: "bank-deposit-slip-history" }),
}));

vi.mock("@/lib/members/roster.server", () => ({
  allianceMemberRowToAshedMember: (row: unknown) => row,
  listAllianceMembers: vi.fn(),
}));

vi.mock("@/lib/video/pipeline-stats-display", () => ({
  isVideoProcessTimings: () => false,
}));

vi.mock("@/lib/video/resolve-job-video-storage", () => ({
  resolveJobVideoStorageKey: vi.fn(),
}));

vi.mock("@/lib/video/video-job-alliance.shared", () => ({
  isVideoJobAllianceStale: () => false,
  VIDEO_JOB_ALLIANCE_UNRESOLVED_CODE: "video_job_alliance_unresolved",
  VIDEO_JOB_ALLIANCE_UNRESOLVED_ERROR: "Alliance context missing on job.",
}));

vi.mock("@/lib/rbac/constants", () => ({
  BANK_READ_PERMISSION: "bank:read",
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: parseSessionLimitMock,
          orderBy: parsedRowsOrderByMock,
        }),
      }),
    }),
  }),
  schema: {
    alliances: { id: "alliances.id", tag: "alliances.tag", name: "alliances.name" },
    parseSessions: {
      id: "parseSessions.id",
      rowCount: "parseSessions.rowCount",
      matchedCount: "parseSessions.matchedCount",
      scoreTarget: "parseSessions.scoreTarget",
      allianceId: "parseSessions.allianceId",
      status: "parseSessions.status",
      dedupeReportJson: "parseSessions.dedupeReportJson",
    },
    parsedRows: {
      parseSessionId: "parsedRows.parseSessionId",
      allianceRank: "parsedRows.allianceRank",
      rank: "parsedRows.rank",
      frameIndex: "parsedRows.frameIndex",
    },
    videoFrames: {
      jobId: "videoFrames.jobId",
      frameIndex: "videoFrames.frameIndex",
      videoTimestampSeconds: "videoFrames.videoTimestampSeconds",
    },
  },
}));

import { GET } from "./route";

describe("GET /api/tools/video-upload/[jobId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOrCreateSessionMock.mockResolvedValue({
      id: "sess-1",
      allianceTag: "LFgo",
      currentAllianceId: "alliance-1",
    });
    resolveVideoJobAccessMock.mockResolvedValue({
      ok: true,
      job: {
        id: "job-1",
        status: "review",
        scoreTarget: "bank-deposit-slip-history",
        category: "bank-deposit-slip-history",
        allianceId: "stored-alliance",
        parseSessionId: "parse-1",
      },
    });
    videoJobAccessErrorResponseMock.mockImplementation(
      (result: { ok: false; status: 403 | 404 }) =>
        NextResponse.json({ error: "Denied" }, { status: result.status }),
    );
    resolveHqAllianceIdFromStoredAllianceIdMock.mockResolvedValue("alliance-1");
    requireAlliancePermissionMock.mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );
    parseSessionLimitMock.mockResolvedValue([
      {
        id: "parse-1",
        rowCount: 2,
        matchedCount: 0,
        scoreTarget: "bank-deposit-slip-history",
        allianceId: "alliance-1",
        status: "review",
        dedupeReportJson: null,
      },
    ]);
    parsedRowsOrderByMock.mockResolvedValue([]);
  });

  it("requires bank read before returning deposit-slip review rows", async () => {
    const res = await GET(new Request("http://localhost/job"), {
      params: Promise.resolve({ jobId: "job-1" }),
    });

    expect({ status: res.status, body: await res.json() }).toEqual({
      status: 403,
      body: { error: "Forbidden" },
    });
    expect(requireAlliancePermissionMock).toHaveBeenCalledWith(
      "sess-1",
      "alliance-1",
      "bank:read",
    );
    expect(parsedRowsOrderByMock).not.toHaveBeenCalled();
  });
});
